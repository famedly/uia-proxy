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
import * as ldapjs from "ldapjs";
import { EventEmitter } from "events";

// we are a test file and thus our linting rules are slightly different
// tslint:disable:no-unused-expression max-file-line-count no-any

async function getProvider() {
	const client = {
		bindAsync: async (usr, pwd) => {
			if (usr.startsWith("cn=invalid")) {
				throw new Error("Invalid login");
			}
		},
		unbind: () => { },
		searchAsync: async (base, options = {} as any) => {
			const ret = new EventEmitter();
			const SEARCH_TIME = 50;
			setTimeout(() => {
				if (base.startsWith("cn=fox,")) {
					ret.emit("searchEntry", { attributes: [
						{
							type: "cn",
							_vals: ["fox"],
						},
						{
							type: "uid",
							_vals: ["hole"],
						},
					]});
				} else {
					ret.emit("error", new ldapjs.NoSuchObjectError());
				}
				ret.emit("end");
			}, SEARCH_TIME);
			return ret;
		},
	} as any;
	const PasswordProvider = proxyquire.load("../../src/passwordproviders/passwordprovider_ldap", {
		"ldapjs": {
			createClient: () => {
				return client;
			},
		},
		"../usernamemapper": { UsernameMapper: {
			usernameToLocalpart: async (username, persistentId) => {
				if (persistentId) {
					return "new" + persistentId;
				}
				return "new" + username;
			},
		}},
	}).PasswordProvider;
	const provider = new PasswordProvider();
	const config = {
		url: "ldap://localhost",
		base: "dc=localhost,dc=localdomain",
		attributes: {
			uid: "cn",
			persistentId: "uid",
		},
	} as any;
	await provider.init(config);
	return provider;
}

describe("PasswordProvider ldap", () => {
	describe("checkPassword", () => {
		it("should deny, should the login fail", async () => {
			const provider = await getProvider();
			provider.verifyLogin = async (username, password) => null;
			const ret = await provider.checkPassword("fox", "secret");
			expect(ret.success).to.be.false;
		});
		it("should accept, should the login be valid", async () => {
			const provider = await getProvider();
			provider.verifyLogin = async (username, password) => {
				return { username: "fox" };
			};
			const ret = await provider.checkPassword("fox", "secret");
			expect(ret.success).to.be.true;
			expect(ret.username).to.be.undefined;
		});
		it("should apply a new username, if a persistent id is present", async () => {
			const provider = await getProvider();
			provider.verifyLogin = async (username, password) => {
				return { username: "fox", persistentId: "hole" };
			};
			const ret = await provider.checkPassword("fox", "secret");
			expect(ret.success).to.be.true;
			expect(ret.username).to.equal("newhole");
		});
	});
	describe("verifyLogin", () => {
		it("should return null, if the login fails", async () => {
			const provider = await getProvider();
			const ret = await provider.verifyLogin("invalid", "blah");
			expect(ret).to.be.null;
		});
		it("should return null, should we be unable to find the user in ldap", async () => {
			const provider = await getProvider();
			const ret = await provider.verifyLogin("semivalid", "blah");
			expect(ret).to.be.null;
		});
		it("should return the full result, if all validates", async () => {
			const provider = await getProvider();
			const ret = await provider.verifyLogin("fox", "blah");
			expect(ret.username).to.equal("fox");
			expect(ret.persistentId).to.equal("hole");
		});
	});
});
