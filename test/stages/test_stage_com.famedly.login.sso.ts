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
import { StageConfig } from "../../src/config";
import { Stage } from "../../src/stages/stage_com.famedly.login.sso";
import { tokens } from "../../src/openid";

// we are a test file and thus our linting rules are slightly different
// tslint:disable:no-unused-expression max-file-line-count no-any

/** Matrix error code for valid but malformed JSON. */
const M_BAD_JSON = "M_BAD_JSON";
/** Matrix error code for uncategorized errors. */
const M_UNKNOWN = "M_UNKNOWN";

async function getStage(): Promise<Stage> {
	const config: StageConfig = {
		homeserver: {
			domain: "example.org",
		},
	} as any;
	const stage = new Stage();
	await stage.init(config);
	return stage;
}

describe("Stage com.famedly.login.sso", () => {
	it("should fail if the identifier is missing", async () => {
		const stage = await getStage();
		const response = await stage.auth({}, null);
		expect(response.success).to.be.false;
		expect(response.errcode).to.equal(M_UNKNOWN);
		expect(response.error).to.equal("Bad identifier type.");
	});
	it("should fail if user or token are missing", async () => {
		const stage = await getStage();
		const response = await stage.auth({ identifier: { type: "m.id.user", user: "alice" } }, null);
		expect(response.success).to.be.false;
		expect(response.errcode).to.equal(M_BAD_JSON);
		expect(response.error).to.equal("Missing username or login token");
	});
	it("should fail if the user is an mxid from the wrong homeserver", async () => {
		const stage = await getStage();
		const data = {
			identifier: { type: "m.id.user", user: "@alice:wrong.website" },
			token: "shouldnt_be_relevant",
		};
		const response = await stage.auth(data, null);
		expect(response.success).to.be.false;
		expect(response.errcode).to.equal(M_UNKNOWN);
		expect(response.error).to.equal("Bad user");
	})
	it("should fail if no token with the given id exists", async () => {
		const stage = await getStage();
		const data = {
			identifier: { type: "m.id.user", user: "alice" },
			token: "does_not_exist",
		};
		const response = await stage.auth(data, null);
		expect(response.success).to.be.false;
		expect(response.errcode).to.equal(M_UNKNOWN);
		expect(response.error).to.equal("Token login failed");
	});
	it("should fail if the token is valid for a different user", async () => {
		const stage = await getStage();
		const data = {
			identifier: { type: "m.id.user", user: "alice" },
			token: "asdf1234",
		};

		tokens.set("asdf1234", {
			token: "asdf1234",
			user: "bob",
			uiaSession: null,
		})
		const response = await stage.auth(data, null);
		tokens.delete("asdf1234");

		expect(response.errcode).to.equal(M_UNKNOWN);
		expect(response.error).to.equal("Token login failed");
	});
	it("should fail if the token is valid for a different UIA session", async () => {
		const stage = await getStage();
		const data = {
			identifier: { type: "m.id.user", user: "alice" },
			token: "1234asdf",
			session: "wrong_session_id",
		};

		tokens.set("1234asdf", {
			token: "1234asdf",
			user: "alice",
			uiaSession: "correct_session_id",
		})
		const response = await stage.auth(data, null);
		tokens.delete("1234asdf");

		expect(response.errcode).to.equal(M_UNKNOWN);
		expect(response.error).to.equal("Token login failed");
	});
	it("should succeed if the token is valid", async () => {
		const stage = await getStage();
		const data = {
			identifier: { type: "m.id.user", user: "alice" },
			token: "asdf1234",
		};

		tokens.set("asdf1234", {
			token: "asdf1234",
			user: "alice",
			uiaSession: null,
		})
		const response = await stage.auth(data, null);
		expect(response.success).to.be.true;
	});
	it("should delete a token after it's been used", async () => {
		const stage = await getStage();
		const data = {
			identifier: { type: "m.id.user", user: "alice" },
			token: "asdf1234",
		};

		tokens.set("asdf1234", {
			token: "asdf1234",
			user: "alice",
			uiaSession: null,
		})
		await stage.auth(data, null);
		expect(tokens.has("asdf1234")).to.be.false;
	})
})
