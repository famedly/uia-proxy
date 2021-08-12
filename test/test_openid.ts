/*
Copyright (C) 2021 Famedly

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

// tslint:disable no-duplicate-imports
import * as chai from "chai";
import { expect } from "chai";
// tslint:enable no-duplicate-imports
import chaiAsPromised from "chai-as-promised";
import { OpenIdConfig } from "../src/config";
import { Oidc } from "../src/openid";

// we are a test file and thus our linting rules are slightly different
// tslint:disable:no-unused-expression max-file-line-count no-any no-magic-numbers

chai.use(chaiAsPromised);

describe("OpenID", () => {
	it("should fail on invalid default provider", async () => {
		const config: OpenIdConfig = {
			default: "wrong",
			providers: {
				correct: {
					issuer: "https://foo.com",
					autodiscover: false,
					client_id: "foo",
					client_secret: "bar",
					scopes: "openid",
				},
			},
		};
		expect(Oidc.factory(config)).to.eventually.throw("non-existant");
	});
	it("should get the correct default", async () => {
		const config: OpenIdConfig = {
			default: "correct",
			providers: {
				correct: {
					issuer: "https://foo.com",
					autodiscover: false,
					client_id: "correct",
					client_secret: "secret",
					scopes: "openid",
				},
				wrong: {
					issuer: "https://foo.com",
					autodiscover: false,
					client_id: "wrong",
					client_secret: "confidential",
					scopes: "openid",
				}
			},
		};
		const openid = await Oidc.factory(config);
		expect(openid.default()).to.equal(openid.provider.correct);
	})
	describe("SSO redirect", () => {
		it("should fail on non-existant provider", async () => {
			const config: OpenIdConfig = {
				default: "provider",
				providers: {
					provider: {
						issuer: "https://foo.com",
						autodiscover: false,
						client_id: "provider",
						client_secret: "secret",
						scopes: "openid",
					}
				}
			}
			const openid = await Oidc.factory(config);
			expect(openid.ssoRedirect("wrong", "https://public.url", "http://not_relevant")).to.be.null;
		})
	})
})
