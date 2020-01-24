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
import { PasswordProvider } from "../../src/passwordproviders/passwordprovider_dummy";

// we are a test file and thus our linting rules are slightly different
// tslint:disable:no-unused-expression max-file-line-count no-any

describe("PasswordProvider dummy", () => {
	it("Should validate, if the configured password matches", async () => {
		const provider = new PasswordProvider();
		await provider.init({ validPassword: "fox" });
		const ret = await provider.checkPassword("blah", "fox");
		expect(ret.success).to.be.true;
	});
	it("Should reject, if the configured password does not match", async () => {
		const provider = new PasswordProvider();
		await provider.init({ validPassword: "fox" });
		const ret = await provider.checkPassword("blah", "bunny");
		expect(ret.success).to.be.false;
	});
});
