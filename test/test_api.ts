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

import { expect } from "chai";
import * as proxyquire from "proxyquire";
import { Api } from "../src/api";

// we are a test file and thus our linting rules are slightly different
// tslint:disable:no-unused-expression max-file-line-count no-any no-magic-numbers

const STATUS_OK = 200;
const STATUS_CREATED = 201;
const STATUS_BAD_REQUEST = 400;
const STATUS_UNAUTHORIZED = 401;
const STATUS_FORBIDDEN = 403;
const STATUS_NOT_FOUND = 404;
const STATUS_CONFLICT = 409;
const STATUS_INTERNAL_SERVER_ERROR = 500;

function getApi() {
	const Api = proxyquire.load("../src/api", {
		"request-promise": async (opts) => {
			if (opts.uri === "https://example.org/_matrix/client/r0/login") {
				if (opts.json.identifier.user === "fox") {
					return {
						user_id: "@fox:example.org",
						access_token: "blah",
					};
				} else {
					throw new Error("Unavailable");
				}
			}
			return null;
		},
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
		status: (status) => {
			RES_STATUS = status;
		},
		send: (text) => {
			RES_SEND = text;
		},
		json: (obj) => {
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
});
