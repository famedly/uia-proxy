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
import { Stage } from "../../src/stages/stage_m.login.password";

// we are a test file and thus our linting rules are slightly different
// tslint:disable:no-unused-expression max-file-line-count no-any

async function getStage() {
	const config = {
		homeserverUrl: "example.org",
		passwordproviderobjects: [{
			checkPassword: async (username, password) => {
				if (username === "valid") {
					return { success: true };
				} else if (username === "fox" ) {
					return { success: true, username: "raccoon" };
				} else {
					return { success: false };
				}
			},
		}],
	} as any;
	const stage = new Stage();
	await stage.init(config);
	return stage;
}

describe("Stage m.login.password", () => {
	it("should complain if the identifier is missing", async () => {
		const stage = await getStage();
		const response = await stage.auth({}, null);
		expect(response.success).to.be.false;
		expect(response.errcode).to.equal("M_UNKNOWN");
		expect(response.error).to.equal("Bad login type.");
	});
	it("should complain about non-m.id.user identifier types", async () => {
		const stage = await getStage();
		const data = { identifier: { type: "m.id.thirdparty" }};
		const response = await stage.auth(data, null);
		expect(response.success).to.be.false;
		expect(response.errcode).to.equal("M_UNKNOWN");
		expect(response.error).to.equal("Bad login type.");
	});
	it("should complain if user or password are missing", async () => {
		const stage = await getStage();
		const data = { identifier: { type: "m.id.user" }};
		const response = await stage.auth(data, null);
		expect(response.success).to.be.false;
		expect(response.errcode).to.equal("M_BAD_JSON");
		expect(response.error).to.equal("Missing username or password");
	});
	it("should complain if the user is an mxid and from the wrong homeserver", async () => {
		const stage = await getStage();
		const data = {
			identifier: { type: "m.id.user", user: "@test:bad" },
			password: "blubb",
		};
		const response = await stage.auth(data, null);
		expect(response.success).to.be.false;
		expect(response.errcode).to.equal("M_UNKNOWN");
		expect(response.error).to.equal("Bad User");
	});
	it("should complain if all password providers reject the user", async () => {
		const stage = await getStage();
		const data = {
			identifier: { type: "m.id.user", user: "@invalid:example.org" },
			password: "blubb",
		};
		const response = await stage.auth(data, null);
		expect(response.success).to.be.false;
		expect(response.errcode).to.equal("M_FORBIDDEN");
		expect(response.error).to.equal("User not found or invalid password");
	});
	it("should allow if a password provider accepts the user", async () => {
		const stage = await getStage();
		const data = {
			identifier: { type: "m.id.user", user: "@valid:example.org" },
			password: "blubb",
		};
		const response = await stage.auth(data, null);
		expect(response.success).to.be.true;
		expect(response.mxid).to.equal("@valid:example.org");
	});
	it("should set the mxid differently, if the password provider says so", async () => {
		const stage = await getStage();
		const data = {
			identifier: { type: "m.id.user", user: "fox" },
			password: "blubb",
		};
		const response = await stage.auth(data, null);
		expect(response.success).to.be.true;
		expect(response.mxid).to.equal("@raccoon:example.org");
	});
});
