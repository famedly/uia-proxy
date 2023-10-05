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
import { Stage } from "../../src/stages/stage_com.famedly.login.welcome_message";

// we are a test file and thus our linting rules are slightly different
/* eslint-disable @typescript-eslint/no-unused-expressions, @typescript-eslint/no-explicit-any */

describe("Stage com.famedly.login.welcome_message", () => {
	it("should authenticate successfully", async () => {
		const stage = new Stage();
		const response = await stage.auth({} as any, null);
		expect(response.success).to.be.true;
	});
	it("should tell if a welcome message is set", async () => {
		const stage = new Stage();
		await stage.init({welcomeMessage: "beeep"} as any);
		expect(await stage.isActive({} as any)).to.be.true;
		expect((await stage.getParams({} as any)).welcome_message).to.equal("beeep");
		await stage.init({welcomeMessage: ""} as any);
		expect(await stage.isActive({} as any)).to.be.false;
		expect((await stage.getParams({} as any)).welcome_message).to.equal("");
	});
});
