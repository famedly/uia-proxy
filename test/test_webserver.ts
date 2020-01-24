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
import { Webserver } from "../src/webserver";
import { Session } from "../src/session";

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

let session: any;
function getWebserver() {
	session = new Session({ timeout: 1200 });
	return new Webserver({} as any, {} as any, session, {} as any);
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
	} as any;
}

let NEXT_CALLED = false;
function getNext() {
	NEXT_CALLED = false;
	return () => {
		NEXT_CALLED = true;
	};
}

describe("Webserver", () => {
	describe("sessionMiddleware", () => {
		it("should add a session if none is provided", () => {
			const webserver = getWebserver();
			const middleware = webserver.sessionMiddleware("/login");
			const req = {} as any;
			middleware(req, getRes(), getNext());
			expect(req.session).to.exist;
			expect(NEXT_CALLED).to.be.true;
			expect(RES_STATUS).to.equal(STATUS_OK);
		});
		it("should use an existing session, if found", () => {
			const webserver = getWebserver();
			const sess = session.new("/login");
			const middleware = webserver.sessionMiddleware("/login");
			const req = { body: { auth: {
				session: sess.id,
			}}} as any;
			middleware(req, getRes(), getNext());
			expect(req.session).eql(sess);
			expect(NEXT_CALLED).to.be.true;
			expect(RES_STATUS).to.equal(STATUS_OK);
		});
		it("should complain if a session is provided, but not found", () => {
			const webserver = getWebserver();
			const middleware = webserver.sessionMiddleware("/login");
			const req = { body: { auth: {
				session: "nonexistant",
			}}} as any;
			middleware(req, getRes(), getNext());
			expect(NEXT_CALLED).to.be.false;
			expect(RES_STATUS).to.equal(STATUS_BAD_REQUEST);
			expect(RES_JSON.errcode).to.equal("M_UNRECOGNIZED");
			expect(RES_JSON.error).to.equal("Invalid session key");
		});
		it("should complain if the session provided is from a different endpoint", () => {
			const webserver = getWebserver();
			const sess = session.new("foxies");
			const middleware = webserver.sessionMiddleware("/login");
			const req = { body: { auth: {
				session: sess.id,
			}}} as any;
			middleware(req, getRes(), getNext());
			expect(NEXT_CALLED).to.be.false;
			expect(RES_STATUS).to.equal(STATUS_BAD_REQUEST);
			expect(RES_JSON.errcode).to.equal("M_UNRECOGNIZED");
			expect(RES_JSON.error).to.equal("Invalid session key");
		});
	});
	describe("validateJsonMiddleware", () => {
		it("should complain if a request post-like method is missing a body", () => {
			const webserver = getWebserver();
			for (const method of ["POST", "PUT", "PATCH"]) {
				const req = { method } as any;
				webserver.validateJsonMiddleware(req, getRes(), getNext());
				expect(NEXT_CALLED).to.be.false;
				expect(RES_STATUS).to.equal(STATUS_BAD_REQUEST);
				expect(RES_JSON.errcode).to.equal("M_NOT_JSON");
				expect(RES_JSON.error).to.equal("No JSON submitted");
			}
		});
		it("should leave get-like methods alone", () => {
			const webserver = getWebserver();
			for (const method of ["GET", "DELETE"]) {
				const req = { method } as any;
				webserver.validateJsonMiddleware(req, getRes(), getNext());
				expect(NEXT_CALLED).to.be.true;
			}
		});
		it("should pass on post-like methods, if they have a body", () => {
			const webserver = getWebserver();
			for (const method of ["POST", "PUT", "PATCH"]) {
				const req = { method, body: {} } as any;
				webserver.validateJsonMiddleware(req, getRes(), getNext());
				expect(NEXT_CALLED).to.be.true;
			}
		});
	});
});
