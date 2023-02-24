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

import { UsernameMapperConfig, UsernameMapperModes } from "../src/config";
import { unwrap } from "../src/fp";
import * as E from "fp-ts/Either"
import { UsernameMapperEntry } from "../src/usernamemapper";

// we are a test file and thus our linting rules are slightly different
// tslint:disable:no-unused-expression max-file-line-count no-any no-magic-numbers

// TODO: Isolate tests, validate actual JSON contents written to the DB

let LEVELUP_SAVED = false;
/** Returns the UsernameMapper class with the key-value database replaced with a mock */
function getMapper(mode?: UsernameMapperModes) {
	LEVELUP_SAVED = false;
	const UsernameMapper = proxyquire.load("../src/usernamemapper", {
		levelup: () => {
			return {
				put: async (key, value) => {
					LEVELUP_SAVED = true;
				},
				get: async (key) => {
					if (key === "37r6x8x94hgux4d8m1b26tx1vujg3dwcguyw4ygpeugv3ph1cgg0") {
						return Buffer.from('{"username": "blubb", "persistentId": "blah"}');
					}
					throw { notFound: true };
				},
			};
		},
	}).UsernameMapper;
	const config = new UsernameMapperConfig({
		folder: "build/usernamemap",
		pepper: "foxies",
	});
	if (mode) {
		config.mode = mode;
	}
	UsernameMapper.Configure(config);
	return UsernameMapper;
}

describe("UsernameMapper", () => {
	describe("UsernameMapperEntry", () => {
		it("should decode valid object without PID", () => {
			const result = UsernameMapperEntry.decode({
				username: "boo",
			});
			expect(unwrap(result).username).to.equal("boo");
		})
		it("should decode valid object with PID", () => {
			const result = UsernameMapperEntry.decode({
				username: "boo",
				persistentId: {
					type: "Buffer",
					data: [0x50, 0x51],
				}
			});
			const entry = unwrap(result);
			expect(Buffer.isBuffer(entry.persistentId!)).to.be.true;
			const equal = entry.persistentId!.equals(Buffer.from("PQ"));
			expect(equal).to.be.true;
		})
		it("should refuse object with wrong PID type", () => {
			const result = UsernameMapperEntry.decode({
					username: "boo",
					persistentId: {
						type: "Wrong",
						data: [0x50, 0x51],
					},
				});
			expect(E.isLeft(result)).to.be.true;
		})
	})
	describe("usernameToLocalpart", () => {
		it("should use the username, if no persistent id is given and default to hmac-sha256 mapping", async () => {
			const mapper = getMapper();
			const ret = await mapper.usernameToLocalpart("blah");
			expect(ret).to.equal("37r6x8x94hgux4d8m1b26tx1vujg3dwcguyw4ygpeugv3ph1cgg0");
			expect(LEVELUP_SAVED).to.be.true;
		});
		it("should use the username, if no persistent id is given and explicit hmac-sha256 is specified", async () => {
			const mapper = getMapper(UsernameMapperModes.HMAC_SHA256);
			const ret = await mapper.usernameToLocalpart("blah");
			expect(ret).to.equal("37r6x8x94hgux4d8m1b26tx1vujg3dwcguyw4ygpeugv3ph1cgg0");
			expect(LEVELUP_SAVED).to.be.true;
		});
		it("should return the username itself when plain-mapping is specified", async () => {
			const mapper = getMapper(UsernameMapperModes.PLAIN);
			const ret = await mapper.usernameToLocalpart("my_beautiful_username");
			expect(ret).to.equal("my_beautiful_username");
		});

		it("should use the persistent id, if it is given", async () => {
			const mapper = getMapper();
			const ret = await mapper.usernameToLocalpart("blubb", "blah");
			expect(ret).to.equal("37r6x8x94hgux4d8m1b26tx1vujg3dwcguyw4ygpeugv3ph1cgg0");
			expect(LEVELUP_SAVED).to.be.true;
		});

		it("should respect utf8 decoding configuration", async () => {
			const mapper = getMapper();
			// UTF-8 encoding of OOPS<misplaced continuation byte>
			const buffer = Buffer.from([0x4F, 0x4F, 0x50, 0x53, 0xA0]);
			const bufferMap = await mapper.usernameToLocalpart("foo", buffer);
			const stringMap = await mapper.usernameToLocalpart("foo", "OOPS�");
			expect(bufferMap).to.equal(stringMap);
			mapper.config.binaryPid = true;
			const bufferMap2 = await mapper.usernameToLocalpart("foo", buffer);
			const stringMap2 = await mapper.usernameToLocalpart("foo", "OOPS�");
			expect(bufferMap2).to.not.equal(stringMap2);
		})
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
				persistentId: Buffer.from("blah"),
			});
		});
		it("should always find a username in plain mapping mode which is the localpart", async () => {
			const mapper = getMapper(UsernameMapperModes.PLAIN);
			const ret = await mapper.localpartToUsername("my_matrix_localpart");
			expect(ret).eql({
				username: "my_matrix_localpart",
			});
		});
	});
});
