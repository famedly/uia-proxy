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

import { expect } from "chai";
import { ensure_localpart } from "../src/stages/stage";

// we are a test file and thus our linting rules are slightly different
// tslint:disable:no-unused-expression max-file-line-count no-any

describe("Stage", () => {
	describe("localpart", () => {
		it("should extract the localpart from the mxid", () => {
			const mxid = "@localpart:some.domain";
			const localpart = ensure_localpart(mxid, "some.domain");
			expect(localpart).to.equal('localpart');
		});
		it("should do nothing with the localpart", () => {
			const mxid = "localpart";
			const localpart = ensure_localpart(mxid, "some.domain");
			expect(localpart).to.equal('localpart');
		});
		it("should error on incorrect domain", () => {
			const mxid = "@localpart:some.domain";
			const localpart = ensure_localpart(mxid, "other.domain");
			expect(localpart).to.be.null;
		});
	})
})
