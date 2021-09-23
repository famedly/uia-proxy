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
// tslint:disable:no-unused-expression max-file-line-count no-any no-magic-numbers

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
		isActive: async (sessionData) => {
			return !Boolean(sessionData && sessionData.disabled);
		},
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
	return new StageHandler("", config, null as any, stages);
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
		it("should return the configured flows", async () => {
			const resp = await sh.getFlows({} as any);
			const NUM_FLOWS = 2;
			const NUM_STAGES = 3;
			expect(resp.length).to.equal(NUM_FLOWS);
			expect(resp[0].stages.length).to.equal(NUM_STAGES);
			expect(resp[1].stages.length).to.equal(NUM_STAGES);
			expect(resp[0].stages).to.eql(["m.login.foo", "m.login.bar", "m.login.dummy"]);
			expect(resp[1].stages).to.eql(["m.login.foo", "m.login.bar", "m.login.fail"]);
		});
		it("should hide a stage, if appropriate", async () => {
			const resp = await sh.getFlows({data: {disabled: true}} as any);
			const NUM_FLOWS = 2;
			const NUM_STAGES = 2;
			expect(resp.length).to.equal(NUM_FLOWS);
			expect(resp[0].stages.length).to.equal(NUM_STAGES);
			expect(resp[1].stages.length).to.equal(NUM_STAGES);
			expect(resp[0].stages).to.eql(["m.login.foo", "m.login.dummy"]);
			expect(resp[1].stages).to.eql(["m.login.foo", "m.login.fail"]);
		});
		it("should do skipping stuff correctly", async () => {
			const resp = await sh.getFlows({
				skippedStages: {
					[0]: new Set([1]),
					[1]: new Set([1]),
				},
				completed: ["m.login.foo"],
				data: {disabled: true},
			} as any);
			const NUM_FLOWS = 2;
			const NUM_STAGES = 2;
			expect(resp.length).to.equal(NUM_FLOWS);
			expect(resp[0].stages.length).to.equal(NUM_STAGES);
			expect(resp[1].stages.length).to.equal(NUM_STAGES);
			expect(resp[0].stages).to.eql(["m.login.foo", "m.login.dummy"]);
			expect(resp[1].stages).to.eql(["m.login.foo", "m.login.fail"]);
		});
		it("should do the past correctly, if a stage was skipped", async () => {
			const resp = await sh.getFlows({
				skippedStages: {
					[0]: new Set([1]),
					[1]: new Set([1]),
				},
				completed: ["m.login.foo", "m.login.dummy"],
			} as any);
			const NUM_FLOWS = 1;
			const NUM_STAGES = 2;
			expect(resp.length).to.equal(NUM_FLOWS);
			expect(resp[0].stages.length).to.equal(NUM_STAGES);
			expect(resp[0].stages).to.eql(["m.login.foo", "m.login.dummy"]);
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
		it("should return false on incomplete stages", async () => {
			const session = { completed: ["m.login.foo"], skippedStages: {}} as any;
			const resp = await sh.areStagesComplete(session);
			expect(resp).to.be.false;
		});
		it("should return false on an invalid stage set", async () => {
			const session = { completed: ["m.login.foo", "m.login.password", "m.login.dummy"], skippedStages: {}} as any;
			const resp = await sh.areStagesComplete(session);
			expect(resp).to.be.false;
		});
		it("should return true on all valid stage possibilities", async () => {
			let session = { completed: ["m.login.foo", "m.login.bar", "m.login.dummy"], skippedStages: {}} as any;
			let resp = await sh.areStagesComplete(session);
			expect(resp).to.be.true;
			session = { completed: ["m.login.foo", "m.login.bar", "m.login.fail"], skippedStages: {}} as any;
			resp = await sh.areStagesComplete(session);
			expect(resp).to.be.true;
		});
	});
	describe("getNextStages", () => {
		it("should return an empty set on an invalid stage", async () => {
			const session = { completed: ["invalid"], skippedStages: {}} as any;
			const resp = await sh.getNextStages(session);
			expect(resp.size).to.equal(0);
		});
		it("should return an empty set on an out-of-order stage", async () => {
			let session = { completed: ["m.login.bar"], skippedStages: {}} as any;
			let resp = await sh.getNextStages(session);
			expect(resp.size).to.equal(0);
			session = { completed: ["m.login.foo", "m.login.dummy"], skippedStages: {}} as any;
			resp = await sh.getNextStages(session);
			expect(resp.size).to.equal(0);
		});
		it("should return the next stages on stage framents", async () => {
			let session = { completed: [], skippedStages: {}} as any;
			let resp = await sh.getNextStages(session);
			expect(resp.size).to.equal(1);
			expect(resp.has("m.login.foo")).to.be.true;
			session = { completed: ["m.login.foo"], skippedStages: {}} as any;
			resp = await sh.getNextStages(session);
			expect(resp.size).to.equal(1);
			expect(resp.has("m.login.bar")).to.be.true;
			session = { completed: ["m.login.foo", "m.login.bar"], skippedStages: {}} as any;
			resp = await sh.getNextStages(session);
			expect(resp.size).to.equal(2);
			expect(resp.has("m.login.dummy")).to.be.true;
			expect(resp.has("m.login.fail")).to.be.true;
			session = { completed: ["m.login.foo", "m.login.bar", "m.login.dummy"], skippedStages: {}} as any;
			resp = await sh.getNextStages(session);
			expect(resp.size).to.equal(0);
			session = { completed: ["m.login.foo", "m.login.bar", "m.login.fail"], skippedStages: {}} as any;
			resp = await sh.getNextStages(session);
			expect(resp.size).to.equal(0);
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
