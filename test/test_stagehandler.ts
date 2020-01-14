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
import { StageHandler } from "../src/stagehandler";
import { Session } from "../src/session";

// we are a test file and thus our linting rules are slightly different
// tslint:disable:no-unused-expression max-file-line-count no-any

const THIRTY_MIN = 30 * 60 * 1000; // tslint:disable-line no-magic-numbers

const sessionHandler = new Session({timeout: THIRTY_MIN});

const STATUS_OK = 200;
const STATUS_BAD_REQUEST = 400;
const STATUS_UNAUTHORIZED = 401;

function getSessionObject() {
	return sessionHandler.new("");
}

function getStageHandler() {
	const config = {
		flows: [
			{ stages: ["m.login.foo", "m.login.bar", "m.login.dummy"] },
			{ stages: ["m.login.foo", "m.login.bar", "m.login.fail"] },
		],
	} as any;
	const stages = new Map<string, any>();
	stages.set("m.login.foo", {
		getParams: async () => {
			return { food: "bunny" };
		},
		auth: async (data, params) => {
			if (data.food === params.food) {
				return { success: true};
			}
			return {
				success: false,
				errcode: "M_WRONG",
				error: "Wrong Food",
			};
		},
	});
	stages.set("m.login.bar", {
		auth: async (data, params) => {
			return { success: true };
		},
	});
	stages.set("m.login.dummy", {
		auth: async (data, params) => {
			return { success: true };
		},
	});
	stages.set("m.login.fail", {
		auth: async (data, params) => {
			return {
				success: false,
				errcode: "M_ERROR",
				error: "This is an error",
			};
		},
	});
	return new StageHandler("", config, stages);
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

describe("StageHandler", () => {
	const sh = getStageHandler();
	describe("getFlows", () => {
		it("should return the configured flows", () => {
			const resp = sh.getFlows();
			const NUM_FLOWS = 2;
			const NUM_STAGES = 3;
			expect(resp.length).to.equal(NUM_FLOWS);
			expect(resp[0].stages.length).to.equal(NUM_STAGES);
			expect(resp[1].stages.length).to.equal(NUM_STAGES);
			expect(resp[0].stages).to.eql(["m.login.foo", "m.login.bar", "m.login.dummy"]);
			expect(resp[1].stages).to.eql(["m.login.foo", "m.login.bar", "m.login.fail"]);
		});
	});
	describe("getParams", () => {
		it("should create the new params, if none provided in the session", async () => {
			const session = getSessionObject();
			const resp = await sh.getParams(session);
			expect(resp).to.eql({"m.login.foo": {food: "bunny"}});
		});
		it("should use existing params, if they are in the session", async () => {
			const session = getSessionObject();
			session.params["m.login.foo"] = {food: "raccoon"};
			const resp = await sh.getParams(session);
			expect(resp).to.eql({"m.login.foo": {food: "raccoon"}});
		});
	});
	describe("areStagesComplete", () => {
		it("should return false on incomplete stages", () => {
			const stages = ["m.login.foo"];
			const resp = sh.areStagesComplete(stages);
			expect(resp).to.be.false;
		});
		it("should return false on an invalid stage set", () => {
			const stages = ["m.login.foo", "m.login.password", "m.login.dummy"];
			const resp = sh.areStagesComplete(stages);
			expect(resp).to.be.false;
		});
		it("should return true on all valid stage possibilities", () => {
			let stages = ["m.login.foo", "m.login.bar", "m.login.dummy"];
			let resp = sh.areStagesComplete(stages);
			expect(resp).to.be.true;
			stages = ["m.login.foo", "m.login.bar", "m.login.fail"];
			resp = sh.areStagesComplete(stages);
			expect(resp).to.be.true;
		});
	});
	describe("areStagesValid", () => {
		it("should return false on an invalid stage", () => {
			const stages = ["invalid"];
			const resp = sh.areStagesValid(stages);
			expect(resp).to.be.false;
		});
		it("should return false on an out-of-order stage", () => {
			let stages = ["m.login.bar"];
			let resp = sh.areStagesValid(stages);
			expect(resp).to.be.false;
			stages = ["m.login.foo", "m.login.dummy"];
			resp = sh.areStagesValid(stages);
			expect(resp).to.be.false;
		});
		it("should return true on stage framents", () => {
			let stages = ["m.login.foo"];
			let resp = sh.areStagesValid(stages);
			expect(resp).to.be.true;
			stages = ["m.login.foo", "m.login.bar"];
			resp = sh.areStagesValid(stages);
			expect(resp).to.be.true;
			stages = ["m.login.foo", "m.login.bar", "m.login.dummy"];
			resp = sh.areStagesValid(stages);
			expect(resp).to.be.true;
			stages = ["m.login.foo", "m.login.bar", "m.login.fail"];
			resp = sh.areStagesValid(stages);
			expect(resp).to.be.true;
		});
	});
	describe("challengeState", () => {
		it("should challenge a stage", async () => {
			const session = getSessionObject();
			session.params["m.login.foo"] = {food: "raccoon"};
			const data = {food: "bunny"};
			let resp = await sh.challengeState("m.login.foo", session, data);
			expect(resp.success).to.be.false;
			session.params["m.login.foo"].food = "bunny";
			resp = await sh.challengeState("m.login.foo", session, data);
			expect(resp.success).to.be.true;
		});
	});
	describe("middleware", () => {
		const session = getSessionObject();
		it("should complain if there is no session object set", async () => {
			await sh.middleware({} as any, getRes(), getNext());
			expect(RES_STATUS).to.equal(STATUS_BAD_REQUEST);
			expect(RES_JSON.errcode).to.equal("M_UNRECOGNIZED");
			expect(NEXT_CALLED).to.be.false;
		});
		it("should return the default information if there is no type specified", async () => {
			const req = { session, body: {} } as any;
			await sh.middleware(req, getRes(), getNext());
			expect(RES_STATUS).to.equal(STATUS_UNAUTHORIZED);
			expect(RES_JSON.session).to.equal(session.id);
			expect(RES_JSON.params).to.eql({"m.login.foo": {food: "bunny"}});
			expect(RES_JSON.errcode).to.be.undefined;
			expect(NEXT_CALLED).to.be.false;
		});
		it("should complain if the specified type is invalid", async () => {
			const req = { session, body: { auth: {
				type: "m.login.dummy",
			}}} as any;
			await sh.middleware(req, getRes(), getNext());
			expect(RES_STATUS).to.equal(STATUS_BAD_REQUEST);
			expect(RES_JSON.errcode).to.equal("M_BAD_JSON");
			expect(NEXT_CALLED).to.be.false;
		});
		it("should say if a challenged state is invalid", async () => {
			const req = { session, body: { auth: {
				type: "m.login.foo",
				food: "fox",
			}}} as any;
			await sh.middleware(req, getRes(), getNext());
			expect(RES_STATUS).to.equal(STATUS_UNAUTHORIZED);
			expect(RES_JSON.errcode).to.equal("M_WRONG");
			expect(NEXT_CALLED).to.be.false;
		});
		it("should complete a stage", async () => {
			const req = { session, body: { auth: {
				type: "m.login.foo",
				food: "bunny",
			}}} as any;
			await sh.middleware(req, getRes(), getNext());
			expect(RES_STATUS).to.equal(STATUS_UNAUTHORIZED);
			expect(RES_JSON.errcode).to.be.undefined;
			expect(RES_JSON.completed).to.eql(["m.login.foo"]);
			expect(NEXT_CALLED).to.be.false;
		});
		it("should not complete stages out-of-order", async () => {
			const req = { session, body: { auth: {
				type: "m.login.dummy",
			}}} as any;
			await sh.middleware(req, getRes(), getNext());
			expect(RES_STATUS).to.equal(STATUS_BAD_REQUEST);
			expect(RES_JSON.errcode).to.equal("M_BAD_JSON");
			expect(NEXT_CALLED).to.be.false;
		});
		it("should complete another stage", async () => {
			const req = { session, body: { auth: {
				type: "m.login.bar",
			}}} as any;
			await sh.middleware(req, getRes(), getNext());
			expect(RES_STATUS).to.equal(STATUS_UNAUTHORIZED);
			expect(RES_JSON.errcode).to.be.undefined;
			expect(RES_JSON.completed).to.eql(["m.login.foo", "m.login.bar"]);
			expect(NEXT_CALLED).to.be.false;
		});
		it("should fail a stage", async () => {
			const req = { session, body: { auth: {
				type: "m.login.fail",
			}}} as any;
			await sh.middleware(req, getRes(), getNext());
			expect(RES_STATUS).to.equal(STATUS_UNAUTHORIZED);
			expect(RES_JSON.errcode).to.equal("M_ERROR");
			expect(RES_JSON.completed).to.eql(["m.login.foo", "m.login.bar"]);
			expect(NEXT_CALLED).to.be.false;
		});
		it("should should complete all stages and call next", async () => {
			const req = { session, body: { auth: {
				type: "m.login.dummy",
			}}} as any;
			await sh.middleware(req, getRes(), getNext());
			expect(NEXT_CALLED).to.be.true;
		});
	});
});
