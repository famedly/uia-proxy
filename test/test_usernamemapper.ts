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

// we are a test file and thus our linting rules are slightly different
// tslint:disable:no-unused-expression max-file-line-count no-any no-magic-numbers

let LEVELUP_SAVED = false;
function getMapper() {
	LEVELUP_SAVED = false;
	const UsernameMapper = proxyquire.load("../src/usernamemapper", {
		levelup: {
			default: () => {
				return {
					put: async (key, value) => {
						LEVELUP_SAVED = true;
					},
					get: async (key) => {
						if (key === "37r6x8x94hgux4d8m1b26tx1vujg3dwcguyw4ygpeugv3ph1cgg0") {
							return Buffer.from("{\"username\": \"blubb\", \"persistentId\": \"blah\"}");
						}
						throw { notFound: true };
					},
				};
			},
		},
	}).UsernameMapper;
	const config = {
		folder: "blah",
		pepper: "foxies",
	} as any;
	UsernameMapper.Configure(config);
	return UsernameMapper;
}

describe("UsernameMapper", () => {
	describe("usernameToLocalpart", () => {
		it("should use the username, if no persistent id is given", async () => {
			const mapper = getMapper();
			const ret = await mapper.usernameToLocalpart("blah");
			expect(ret).to.equal("37r6x8x94hgux4d8m1b26tx1vujg3dwcguyw4ygpeugv3ph1cgg0");
			expect(LEVELUP_SAVED).to.be.true;
		});
		it("should use the persistent id, if it is given", async () => {
			const mapper = getMapper();
			const ret = await mapper.usernameToLocalpart("blubb", "blah");
			expect(ret).to.equal("37r6x8x94hgux4d8m1b26tx1vujg3dwcguyw4ygpeugv3ph1cgg0");
			expect(LEVELUP_SAVED).to.be.true;
		});
	});
	describe("localpartToUsername", () => {
		it("should return null, if the localpart isn't found", async () => {
			const mapper = getMapper();
			const ret = await mapper.localpartToUsername("blubb");
			expect(ret).to.be.null;
		});
		it("should return the username, if it is found", async () => {
			const mapper = getMapper();
			const ret = await mapper.localpartToUsername("37r6x8x94hgux4d8m1b26tx1vujg3dwcguyw4ygpeugv3ph1cgg0");
			expect(ret).eql({
				username: "blubb",
				persistentId: "blah",
			});
		});
	});
});
