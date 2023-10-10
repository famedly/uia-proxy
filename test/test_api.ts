/*
Copyright (C) 2020, 2021 Famedly

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

import { expect } from "chai";
import * as proxyquire from "proxyquire";
import * as jwt from "jsonwebtoken";

// we are a test file and thus our linting rules are slightly different
/* eslint-disable @typescript-eslint/no-unused-expressions, @typescript-eslint/no-explicit-any, no-magic-numbers */

const STATUS_OK = 200;
const STATUS_CREATED = 201;
const STATUS_BAD_REQUEST = 400;
const STATUS_UNAUTHORIZED = 401;
const STATUS_FORBIDDEN = 403;
const STATUS_NOT_FOUND = 404;
const STATUS_CONFLICT = 409;
const STATUS_INTERNAL_SERVER_ERROR = 500;

function getApi() {
	// eslint-disable-next-line @typescript-eslint/naming-convention
	const Api = proxyquire.load("../src/api", {
		got: { default: (opts) => {
			if (opts.url === "https://example.org/_matrix/client/r0/login") {
				if (opts.json.identifier.user === "fox") {
					return {
						json: async () => {
							return {
								user_id: "@fox:example.org",
								access_token: "blah",
							};
						},
					};
				} else {
					throw new Error("Unavailable");
				}
			}
			if (opts.url === "https://example.org/bad") {
				throw new Error("Unavailable");
			}
			if (opts.url === "https://example.org/" + opts.method) {
				return {
					json: async () => {
						return {
							method: opts.method,
							json: opts.json,
						};
					},
				};
			}
			return null;
		}},
	}).Api;
	const config = {
		domain: "example.org",
		url: "https://example.org",
		token: {
			secret: "foxies",
			algorithm: "HS512",
			expires: 120 * 1000,
		},
	} as any;
	const api = new Api(config);
	return api;
}

let RES_STATUS = STATUS_OK;
let RES_SEND = "";
let RES_JSON = {} as any;
function getRes() {
	RES_STATUS = STATUS_OK;
	RES_SEND = "";
	RES_JSON = {};
	return {
		status: (status: number) => {
			RES_STATUS = status;
		},
		send: (text: string) => {
			RES_SEND = text;
		},
		json: (obj: any) => {
			RES_JSON = obj;
		},
	};
}

describe("Api", () => {
	describe("login", () => {
		it("should complain if a session is missing", async () => {
			const api = getApi();
			await api.login({} as any, getRes());
			expect(RES_STATUS).to.equal(STATUS_BAD_REQUEST);
			expect(RES_JSON.errcode).to.equal("M_UNKNOWN");
			expect(RES_JSON.error).to.equal("No session");
		});
		it("should complain if the session doesn't include a username", async () => {
			const api = getApi();
			const req = { session: { data: { }}} as any;
			await api.login(req, getRes());
			expect(RES_STATUS).to.equal(STATUS_BAD_REQUEST);
			expect(RES_JSON.errcode).to.equal("M_UNKNOWN");
			expect(RES_JSON.error).to.equal("No username found");
		});
		it("should log the user in, if all is valid", async () => {
			const api = getApi();
			const req = { session: { data: {
				username: "fox",
			}}} as any;
			await api.login(req, getRes());
			expect(RES_STATUS).to.equal(STATUS_OK);
			expect(RES_JSON.user_id).to.equal("@fox:example.org");
			expect(RES_JSON.access_token).to.equal("blah");
		});
				it("should complain if the backend is unreachable", async () => {
			const api = getApi();
			const req = { session: { data: {
				username: "no backend",
			}}} as any;
			await api.login(req, getRes());
			expect(RES_STATUS).to.equal(STATUS_INTERNAL_SERVER_ERROR);
			expect(RES_JSON.errcode).to.equal("M_UNKNOWN");
			expect(RES_JSON.error).to.equal("Backend unreachable");
		});
	});
	describe("proxyRequest", async () => {
		it("should complain if a session is missing", async () => {
			const api = getApi();
			await api.proxyRequest({} as any, getRes());
			expect(RES_STATUS).to.equal(STATUS_BAD_REQUEST);
			expect(RES_JSON.errcode).to.equal("M_UNKNOWN");
			expect(RES_JSON.error).to.equal("No session");
		});
		it("should complain if the session doesn't include a username", async () => {
			const api = getApi();
			const req = { session: { data: { }}} as any;
			await api.proxyRequest(req, getRes());
			expect(RES_STATUS).to.equal(STATUS_BAD_REQUEST);
			expect(RES_JSON.errcode).to.equal("M_UNKNOWN");
			expect(RES_JSON.error).to.equal("No username/password found or bad password provider");
		});
		it("should complain if the backend is unreachable", async () => {
			const api = getApi();
			const req = {
				method: "get",
				path: "/bad",
				session: { data: { username: "blah" }},
			} as any;
			await api.proxyRequest(req, getRes());
			expect(RES_STATUS).to.equal(STATUS_INTERNAL_SERVER_ERROR);
			expect(RES_JSON.errcode).to.equal("M_UNKNOWN");
			expect(RES_JSON.error).to.equal("Backend unreachable");
		});
		it("should proxy stuff", async () => {
			const api = getApi();
			const req = {
				method: "POST",
				path: "/POST",
				session: { data: { username: "blah" }},
			} as any;
			await api.proxyRequest(req, getRes());
			expect(RES_STATUS).to.equal(STATUS_OK);
			expect(RES_JSON.method).to.equal("POST");
			expect(RES_JSON.json.auth.type).to.equal("com.famedly.login.token");
			expect(RES_JSON.json.auth.identifier).to.eql({
				type: "m.id.user",
				user: "blah",
			});
			expect(RES_JSON.json.auth.user).to.equal("blah");
			expect(RES_JSON.json.auth.token).to.be.ok;
		});
		it("should add data to the proxy", async () => {
			const api = getApi();
			const req = {
				method: "PUT",
				path: "/PUT",
				session: { data: { username: "blah" }},
				body: { fox: "floof" },
			} as any;
			await api.proxyRequest(req, getRes());
			expect(RES_STATUS).to.equal(STATUS_OK);
			expect(RES_JSON.method).to.equal("PUT");
			expect(RES_JSON.json.fox).to.equal("floof");
			expect(RES_JSON.json.auth.type).to.equal("com.famedly.login.token");
			expect(RES_JSON.json.auth.identifier).to.eql({
				type: "m.id.user",
				user: "blah",
			});
			expect(RES_JSON.json.auth.user).to.equal("blah");
			expect(RES_JSON.json.auth.token).to.be.ok;
		});
	});
	describe("generateToken", async () => {
		it("should contain username", async () => {
			const api = getApi();
			const token = jwt.decode(api.generateToken(
				"fox",
				true,
				"Fuzzy Fox"
			));
			if (typeof token === "string") {
				throw new TypeError("JWT should not be string");
			} else if (!token) {
				throw new TypeError("JWT should not be null");
			}
			expect(token.sub).to.equal("fox");
		});
		it("should contain admin", async () => {
			const api = getApi();
			const token = jwt.decode(api.generateToken(
				"fox",
				true,
				"Fuzzy Fox"
			));
			if (typeof token === "string") {
				throw new TypeError("JWT should not be string");
			} else if (!token) {
				throw new TypeError("JWT should not be null");
			}
			expect(token.admin).to.equal(true);
		});
		it("should contain display name", async () => {
			const api = getApi();
			const token = jwt.decode(api.generateToken(
				"fox",
				true,
				"Fuzzy Fox"
			));
			if (typeof token === "string") {
				throw new TypeError("JWT should not be string");
			} else if (!token) {
				throw new TypeError("JWT should not be null");
			}
			expect(token.displayname).to.equal("Fuzzy Fox");
		});
	});
});

