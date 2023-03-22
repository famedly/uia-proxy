/*
Copyright (C) 2020 Famedly

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <http://www.gnu.org/licenses/>.
*/

import { expect, use as chaiUse } from "chai";
import chaiAsPromised from "chai-as-promised";
import { SingleUiaConfig, StageConfig, UsernameMapperConfig, UsernameMapperModes } from "../../src/config";
import { Stage, IOpenIdConfig } from "../../src/stages/stage_com.famedly.login.sso";
import { Oidc, OidcSession } from "../../src/stages/com.famedly.login.sso/openid";
import { UsernameMapper } from "../../src/usernamemapper";
import { STATUS_OK, STATUS_FOUND, STATUS_BAD_REQUEST, STATUS_UNAUTHORIZED } from "../../src/webserver";
import { TokenSet } from "openid-client";

// we are a test file and thus our linting rules are slightly different
// tslint:disable:no-unused-expression max-file-line-count no-any no-string-literal

chaiUse(chaiAsPromised);

/** Matrix error code for valid but malformed JSON. */
const M_BAD_JSON = "M_BAD_JSON";
/** Matrix error code for uncategorized errors. */
const M_UNKNOWN = "M_UNKNOWN";

UsernameMapper.Configure(Object.assign(new UsernameMapperConfig(), {
	mode: UsernameMapperModes.PLAIN,
	folder: "blah",
	pepper: "foxies",
}));

let RES_STATUS = STATUS_OK;
let RES_SEND = "";
let RES_JSON = {} as any;
let RES_REDIRECT = "";
function getRes() {
	RES_STATUS = STATUS_OK;
	RES_SEND = "";
	RES_JSON = {};
	RES_REDIRECT = "";
	return {
		status: (status) => {
			RES_STATUS = status;
		},
		send: (text) => {
			RES_SEND = text;
		},
		json: (obj) => {
			RES_JSON = obj;
		},
		redirect: (status, url) => {
			RES_STATUS = status;
			RES_REDIRECT = url;
		},
	};
}

const EXPRESS_CALLBACKS = {};
async function getStage(setConfig?: any, jsonRedirect = false): Promise<Stage> {
	const config: IOpenIdConfig = {
		providers: {
			correct: {
				issuer: "https://foo.com",
				autodiscover: false,
				introspect: true,
				introspection_endpoint: "https://foo.com/introspect",
				client_id: "correct",
				client_secret: "secret",
				scopes: "openid",
				authorization_endpoint: "https://foo.com/authorization",
			},
			wrong: {
				issuer: "https://foo.com",
				autodiscover: false,
				client_id: "wrong",
				client_secret: "confidential",
				scopes: "openid",
			},
		},
		endpoints: {
			json_redirects: jsonRedirect,
			redirect: '/redirect',
			callback: '/callback',
		},
		homeserver: {
			domain: 'example.org',
		} as any,
		...(setConfig || {})
	};

	// Make sure we get a clean state for each test
	Stage['openidMap'] = new Map();
	const stage = new Stage();
	await stage.init(config, {
		express: {
			get: (path, callback) => {
				EXPRESS_CALLBACKS[path] = callback;
			},
		} as any,
	});
	return stage;
}

describe("Stage com.famedly.login.sso", () => {
	describe("express redirect callback", () => {
		it("should complain if query parameters are missing", async () => {
			const stage = await getStage();
			EXPRESS_CALLBACKS["/redirect/correct"]({query: {}} as any, getRes());
			expect(RES_STATUS).to.equal(STATUS_BAD_REQUEST);
			expect(RES_JSON).to.eql({
				errcode: "M_UNRECOGNIZED",
				error: "Missing redirectUrl",
			});
		});
		it("should work, if all is ok", async () => {
			const stage = await getStage();
			EXPRESS_CALLBACKS["/redirect/correct"]({
				query: {redirectUrl: "http://localhost", uiaSession: "fox"},
				params: {provider: "correct"},
			} as any, getRes());
			expect(RES_STATUS).to.equal(STATUS_FOUND);
			expect(RES_REDIRECT.split("&state=")[0]).to.equal("https://foo.com/authorization?client_id=correct&scope=openid&response_type=code&redirect_uri=https%3A%2F%2Fexample.org%2Fcallback");
		});
	});
	describe("express callback callback", () => {
		it("should complain if there is no state", async () => {
			const stage = await getStage();
			await EXPRESS_CALLBACKS["/callback"]({query: {}} as any, getRes());
			expect(RES_STATUS).to.equal(STATUS_BAD_REQUEST);
			expect(RES_JSON).to.eql({
				errcode: "M_UNRECOGNIZED",
				error: "Missing state query parameter",
			});
		});
		it("should deny, if oidc doesn't give a redirect url", async () => {
			const stage = await getStage();
			const origOpenid = stage["openid"];
			stage["setOpenid"]({
				oidcCallback: async (p, r, b, u) => null,
			} as any);
			await EXPRESS_CALLBACKS["/callback"]({query: { state: "beep" }} as any, getRes());
			stage["setOpenid"](origOpenid);
			expect(RES_STATUS).to.equal(STATUS_UNAUTHORIZED);
		});
		it("should redirect, if all is ok", async () => {
			const stage = await getStage();
			const origOpenid = stage["openid"];
			stage["setOpenid"]({
				oidcCallback: async (p, r, b, u) => "http://new-url",
			} as any);
			await EXPRESS_CALLBACKS["/callback"]({query: { state: "beep" }} as any, getRes());
			stage["setOpenid"](origOpenid);
			expect(RES_STATUS).to.equal(STATUS_FOUND);
			expect(RES_REDIRECT).to.equal("http://new-url");
		});
		it("should perform introspection if configured", async () => {
			// Enable introspection in the config
			const stage = await getStage({
				providers: {
					correct: {
						introspect: true,
						introspection_url: "https://example.test/introspect"
					}
				}
			});
			const openid = stage["openid"];
			const provider = openid.provider.correct!;
			let introspected = false;
			// A mock openid client. introspect is the relevant part, the rest is nonsense data.
			const client = ({
				introspect: () => {
					introspected = true;
					return { active: true }
				},
				callbackParams: () => ({}),
				callback: async () => ({
					claims: () => ({
						sub: "subject",
						id_token: "non_null"
					}),
				}),
			}) as any;
			await provider.oidcCallback(
				"/foo",
				// the client is important, the rest is placeholder
				new OidcSession("id", "correct", "http://localhost", client, "floof"),
				"https://localhost"
			);
			expect(introspected).to.be.true;
		});
		it("should fail if introspection returns inactive", async () => {
			// Enable introspection in the config
			const stage = await getStage({
				providers: {
					correct: {
						introspect: true,
						introspection_url: "https://example.test/introspect"
					}
				}
			});
			const openid = stage["openid"];
			const provider = openid.provider.correct!;
			// A mock openid client. introspect is the relevant part, the rest is placeholder
			const client = ({
				introspect: () => {
					return { active: false }
				},
				callbackParams: () => ({}),
				callback: async () => ({
					claims: () => ({
						sub: "subject",
						id_token: "non_null"
					}),
				}),
			}) as any;
			const response = await provider.oidcCallback(
				"/foo",
				// the client is important, the rest is placeholder
				new OidcSession("id", "correct", "http://localhost", client, "floof"),
				"https://localhost"
			);
			expect(response).to.have.property('errcode').with.equal("F_TOKEN_INACTIVE");
		})
	});
	describe("getParams", () => {
		it("should get the params correctly", async () => {
			const stage = await getStage();
			const params = await stage.getParams({
				sessionId: "floof",
			} as any);
			expect(params).to.eql({
				providers: {
					correct: "https://example.org/redirect/correct?uiaSession=floof",
					wrong: "https://example.org/redirect/wrong?uiaSession=floof",
				},
			});
		});
	});
	describe("auth", () => {
		it("should fail if the token is missing", async () => {
			const stage = await getStage();
			const response = await stage.auth({}, null);
			expect(response.success).to.be.false;
			expect(response.errcode).to.equal(M_BAD_JSON);
			expect(response.error).to.equal("Missing login token");
		});
		it("should fail if no token with the given id exists", async () => {
			const stage = await getStage();
			const data = {
				token: "correct|does_not_exist",
			};
			const response = await stage.auth(data, null);
			expect(response.success).to.be.false;
			expect(response.errcode).to.equal("M_FORBIDDEN");
			expect(response.error).to.equal("Token login failed: Token is invalid");
		});
		it("should fail if the token is valid for a different UIA session", async () => {
			const stage = await getStage();
			const data = {
				token: "correct|1234asdf",
				session: "wrong_session_id",
			};

			stage["openid"].provider.correct!.tokens.set("correct|1234asdf", {
				token: "correct|1234asdf",
				user: "alice",
				uiaSession: "correct_session_id",
			});
			const response = await stage.auth(data, null);
			stage["openid"].provider.correct!.tokens.delete("correct|1234asdf");

			expect(response.errcode).to.equal("M_FORBIDDEN");
			expect(response.error).to.equal("Token login failed: Token is invalid");
		});
		it("should only require uiaSession when needed", async () => {
			const stage = await getStage();
			const data = {
				token: "correct|asdf1234",
			};

			stage["openid"].provider.correct!.tokens.set("correct|asdf1234", {
				token: "correct|asdf1234",
				user: "alice",
			});
			const response = await stage.auth(data, null);
			expect(response).to.have.property('success', true);
			expect(response).to.have.nested.property('data.username', "correct/alice");
		})
		it("should succeed if the token is valid", async () => {
			const stage = await getStage();
			const data = {
				token: "correct|asdf1234",
				session: "correct_session_id",
			};

			stage["openid"].provider.correct!.tokens.set("correct|asdf1234", {
				token: "correct|asdf1234",
				user: "alice",
				uiaSession: "correct_session_id",
			})
			const response = await stage.auth(data, null);
			expect(response.success).to.be.true;
			expect(response.data!.username).to.equal("correct/alice");
		});
		it("should build other mxids", async () => {
			const stage = await getStage({
				providers: {
					correct: { namespace: "fox" },
				},
				endpoints: {
					redirect: "/fox_redirect",
					callback: "/fox_callback",
				},
			});
			const data = {
				token: "correct|asdf1234",
				session: "correct_session_id",
			};

			stage["openid"].provider.correct!.tokens.set("correct|asdf1234", {
				token: "correct|asdf1234",
				user: "alice",
				uiaSession: "correct_session_id",
			})
			const response = await stage.auth(data, null);
			expect(response.success).to.be.true;
			expect(response.data!.username).to.equal("fox/alice");
		});
		it("should delete a token after it's been used", async () => {
			const stage = await getStage();
			const data = {
				token: "correct|asdf1234",
				session: "correct_session_id",
			};

			stage["openid"].provider.correct!.tokens.set("correct|asdf1234", {
				token: "correct|asdf1234",
				user: "alice",
				uiaSession: "correct_session_id",
			})
			await stage.auth(data, null);
			expect(stage["openid"].provider.correct!.tokens.has("correct|asdf1234")).to.be.false;
		});
	});
	describe("OpenID", () => {
		it("should fail on invalid default provider", async () => {
			const config: IOpenIdConfig = {
				default: "wrong",
				providers: {
					correct: {
						issuer: "https://foo.com",
						autodiscover: false,
						introspect: false,
						client_id: "foo",
						client_secret: "bar",
						scopes: "openid",
					},
				},
				endpoints: {
					json_redirects: false,
					redirect: 'http://redirect',
					callback: 'http://callback',
				},
				homeserver: {
					domain: 'example.org',
				} as any,
			};
			expect(Oidc.factory(config)).to.eventually.throw("non-existent");
		});
		it("should get the correct default", async () => {
			const config: IOpenIdConfig = {
				default: "correct",
				providers: {
					correct: {
						issuer: "https://foo.com",
						autodiscover: false,
						introspect: false,
						client_id: "correct",
						client_secret: "secret",
						scopes: "openid",
					},
					wrong: {
						issuer: "https://foo.com",
						autodiscover: false,
						introspect: false,
						client_id: "wrong",
						client_secret: "confidential",
						scopes: "openid",
					}
				},
				endpoints: {
					json_redirects: false,
					redirect: 'http://redirect',
					callback: 'http://callback',
				},
				homeserver: {
					domain: 'example.org',
				} as any,
			};
			const openid = await Oidc.factory(config);
			expect(openid.default()).to.equal(openid.provider.correct);
		});
		describe("SSO redirect", () => {
			it("should fail on non-existent provider", async () => {
				const config: IOpenIdConfig = {
					default: "provider",
					providers: {
						provider: {
							issuer: "https://foo.com",
							autodiscover: false,
							introspect: false,
							client_id: "provider",
							client_secret: "secret",
							scopes: "openid",
						},
					},
					endpoints: {
						json_redirects: false,
						redirect: 'http://redirect',
						callback: 'http://callback',
					},
					homeserver: {
						domain: 'example.org',
					} as any,
				};
				const openid = await Oidc.factory(config);
				expect(openid.ssoRedirect("wrong", "https://public.url", "http://not_relevant", "not_relevant")).to.be.null;
			});
		});
	});
});

// While this doubles some tests it makes sure that in json_redirect mode we dont break the stage due to the extra handling
describe("Stage m.login.sso (json_redirect mode)", () => {
	describe("express redirect callback", () => {
		it("should complain if query parameters are missing", async () => {
			const stage = await getStage(undefined, true);
			EXPRESS_CALLBACKS["/redirect/correct"]({query: {}} as any, getRes());
			expect(RES_STATUS).to.equal(STATUS_BAD_REQUEST);
			expect(RES_JSON).to.eql({
				errcode: "M_UNRECOGNIZED",
				error: "Missing redirectUrl",
			});
		});
		it("should allow uiaSession being absent", async () => {
			const stage = await getStage(undefined, true);
			EXPRESS_CALLBACKS["/redirect/correct"]({
				query: {redirectUrl: "http://localhost"},
				params: {provider: "correct"},
			}, getRes())
			expect(RES_STATUS).to.equal(STATUS_OK);
		})
		it("should work, if all is ok", async () => {
			const stage = await getStage(undefined, true);
			EXPRESS_CALLBACKS["/redirect/correct"]({
				query: {redirectUrl: "http://localhost", uiaSession: "fox"},
				params: {provider: "correct"},
			} as any, getRes());
			expect(RES_STATUS).to.equal(STATUS_OK);
			expect(RES_JSON["location"].split("&state=")[0]).to.equal("https://foo.com/authorization?client_id=correct&scope=openid&response_type=code&redirect_uri=https%3A%2F%2Fexample.org%2Fcallback");
		});
	});
	describe("express callback callback", () => {
		it("should complain if there is no state", async () => {
			const stage = await getStage(undefined, true);
			await EXPRESS_CALLBACKS["/callback"]({ query: {} } as any, getRes());
			expect(RES_STATUS).to.equal(STATUS_BAD_REQUEST);
			expect(RES_JSON).to.eql({
				errcode: "M_UNRECOGNIZED",
				error: "Missing state query parameter",
			});
		});
		it("should deny, if oidc doesn't give a redirect url", async () => {
			const stage = await getStage(undefined, true);
			const origOpenid = stage["openid"];
			stage["setOpenid"]({
				oidcCallback: async (p, r, b, u) => null,
			} as any);
			await EXPRESS_CALLBACKS["/callback"]({ query: { state: "beep" } } as any, getRes());
			stage["setOpenid"](origOpenid);
			expect(RES_STATUS).to.equal(STATUS_UNAUTHORIZED);
		});
		it("should redirect, if all is ok", async () => {
			const stage = await getStage(undefined, true);
			const origOpenid = stage["openid"];
			stage["setOpenid"]({
				oidcCallback: async (p, r, b, u) => "http://new-url",
			} as any);
			await EXPRESS_CALLBACKS["/callback"]({ query: { state: "beep" } } as any, getRes());
			stage["setOpenid"](origOpenid);
			expect(RES_STATUS).to.equal(STATUS_OK);
			expect(RES_JSON["location"]).to.equal("http://new-url");
		});
		it("should perform introspection if configured", async () => {
			// Enable introspection in the config
			const stage = await getStage({
				providers: {
					correct: {
						introspect: true,
						introspection_url: "https://example.test/introspect"
					}
				}
			}, true);
			const openid = stage["openid"];
			const provider = openid.provider.correct!;
			let introspected = false;
			// A mock openid client. introspect is the relevant part, the rest is nonsense data.
			const client = ({
				introspect: () => {
					introspected = true;
					return { active: true };
				},
				callbackParams: () => ({}),
				callback: async () => ({
					claims: () => ({
						sub: "subject",
						id_token: "non_null"
					}),
				}),
			}) as any;
			await provider.oidcCallback(
				"/foo",
				// the client is important, the rest is placeholder
				new OidcSession("id", "correct", "http://localhost", client, "floof"),
				"https://localhost"
			);
			expect(introspected).to.be.true;
		});
		it("should fail if introspection returns inactive", async () => {
			// Enable introspection in the config
			const stage = await getStage({
				providers: {
					correct: {
						introspect: true,
						introspection_url: "https://example.test/introspect"
					}
				}
			}, true);
			const openid = stage["openid"];
			const provider = openid.provider.correct!;
			// A mock openid client. introspect is the relevant part, the rest is placeholder
			const client = ({
				introspect: () => {
					return { active: false };
				},
				callbackParams: () => ({}),
				callback: async () => ({
					claims: () => ({
						sub: "subject",
						id_token: "non_null"
					}),
				}),
			}) as any;
			const response = await provider.oidcCallback(
				"/foo",
				// the client is important, the rest is placeholder
				new OidcSession("id", "correct", "http://localhost", client, "floof"),
				"https://localhost"
			);
			expect(response).to.have.property('errcode').with.equal("F_TOKEN_INACTIVE");
		});
	});
});
