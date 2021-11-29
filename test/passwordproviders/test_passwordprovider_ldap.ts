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
// tslint:disable:no-unused-expression max-file-line-count no-any no-magic-numbers no-string-literal

async function getProvider(attributeOverride?) {
	const client = {
		bindAsync: async (usr, pwd) => {
			const fakeInvalidUser = usr.match(/^(uid=(new)?invalid)/);
			if (fakeInvalidUser != null) {
				throw new Error("Invalid login");
			}
		},
		unbind: () => { },
		searchAsync: async (base, options = {} as any) => {
			const ret = new EventEmitter();
			const SEARCH_TIME = 50;
			setTimeout(() => {
				if (options.scope === "sub") {
					const matches = options.filter.match(/\(uid=(\w+)\)/);
					const name = matches ? matches[1] : null;
					ret.emit("searchEntry", { attributes: [
						{
							type: "dn",
							_vals: [`uid=${name},${config.userBase}`],
						},
						{
							type: "uid",
							_vals: [name],
						},
						{
							type: "persistentId",
							_vals: ["pid" + name],
						},
						{
							type: "enabled",
							_vals: [(name === 'deactivated') ? "FALSE" : "TRUE"],
						},
					]});
				} else if (base === "cn=deactivatedUsers,ou=groups,dc=famedly,dc=de") {
					if (options.filter !== "(&(objectClass=*)(member=cn=deactivated,dc=localhost,dc=localdomain))") {
						ret.emit("error", new ldapjs.NoSuchObjectError());
					} else  {
						ret.emit("searchEntry", { attributes: [
							{
								type: "member",
								_vals: ["cn=deactivated,dc=localhost,dc=localdomain"],
							},
						]});
					}
				} else if (base.match(/uid=(fox),/)) {
					ret.emit("searchEntry", { attributes: [
						{
							type: "uid",
							_vals: ["fox"],
						},
						{
							type: "persistentId",
							_vals: ["pidfox"],
						},						{
							type: "displayname",
							_vals: ["Pixel"],
						},
					]});
				} else if (base.match(/uid=(bat),/)) {
					ret.emit("searchEntry", { attributes: [
							{
								type: "uid",
								_vals: ["bat"],
							},
							{
								type: "persistentId",
								_vals: ["pidbat"],
							}
						]}); }
				else if (base.match(/uid=deactivated,/)) {
					ret.emit("searchEntry", { attributes: [
						{
							type: "uid",
							_vals: ["deactivated"],
						},
						{
							type: "persistentId",
							_vals: ["piddeactivated"],
						},
						{
							type: "enabled",
							_vals: ["FALSE"],
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
			localpartToUsername: async (localpart) => {
				if (!localpart.startsWith("new")) {
					return null;
				}
				return {
					username: localpart.substring("new".length),
					persistentId: "pid" + localpart.substring("new".length),
				};
			},
		}},
	}).PasswordProvider;
	const provider = new PasswordProvider();
	const attributes = attributeOverride ?? {
		uid: "uid",
			persistentId: "persistentId",
			enabled: "enabled",
			displayname: "displayname"
	}
	const config = {
		url: "ldap://localhost",
		base: "dc=localhost,dc=localdomain",
		userBase: "ou=users,dc=localhost,dc=localdomain",
		userFilter: "(&(uid=%s)(objectClass=inetOrgPerson))",
		bindDn: "cn=admin,dc=localhost,dc=localdomain",
		bindPassword: "foxies",
		deactivatedGroup: "cn=deactivatedUsers,ou=groups,dc=famedly,dc=de",
		attributes,
	} as any;
	await provider.init(config);
	return provider;
}

describe("PasswordProvider ldap", () => {
	describe("checkUser", () => {
		it("should deny, should the login fail", async () => {
			const provider = await getProvider();
			provider["getLoginInfo"] = async (username, password) => null;
			const ret = await provider.checkUser("fox", "secret");
			expect(ret.success).to.be.false;
		});
		it("should accept, should the login be valid", async () => {
			const provider = await getProvider();
			provider["getLoginInfo"] = async (username, password) => {
				return { username: "fox" };
			};
			const ret = await provider.checkUser("fox", "secret");
			expect(ret.success).to.be.true;
			expect(ret.username).to.be.undefined;
		});
		it("should apply a new username, if a persistent id is present", async () => {
			const provider = await getProvider();
			provider["getLoginInfo"] = async (username, password) => {
				return { username: "fox", persistentId: "hole" };
			};
			const ret = await provider.checkUser("fox", "secret");
			expect(ret.success).to.be.true;
			expect(ret.username).to.equal("newhole");
		});
	});
	describe("getLoginInfo", () => {
		it("should return null, if the login fails", async () => {
			const provider = await getProvider();
			const ret = await provider["getLoginInfo"]("invalid", "blah");
			expect(ret).to.be.null;
		});
		it("should return null, should we be unable to find the user in ldap", async () => {
			const provider = await getProvider();
			const ret = await provider["getLoginInfo"]("semivalid", "blah");
			expect(ret).to.be.null;
		});
		it("should return the full result, if all validates", async () => {
			const provider = await getProvider();
			const ret = await provider["getLoginInfo"]("fox", "blah");
			expect(ret.username).to.equal("fox");
			expect(ret.persistentId).to.equal("pidfox");
			expect(ret.displayname).to.equal("Pixel");
		});
		it("should return the result without displayname, if displayname isn't defined", async () => {
			const provider = await getProvider();
			const ret = await provider["getLoginInfo"]("bat", "blah");
			expect(ret.username).to.equal("bat");
			expect(ret.persistentId).to.equal("pidbat");
			expect(ret.displayname).to.be.undefined;
		});
		it("should return the result without displayname, if displayname attribute isn't configured", async () => {
			const provider = await getProvider({
				uid: "uid",
				persistentId: "persistentId",
				enabled: "enabled",
			});
			const ret = await provider["getLoginInfo"]("fox", "blah");
			expect(ret.username).to.equal("fox");
			expect(ret.persistentId).to.equal("pidfox");
			expect(ret.displayname).to.be.undefined;
		});
	});
	describe("bind", () => {
		it("should return null, if the user is not found", async () => {
			const provider = await getProvider();
			const ret = await provider["bind"]("invalid", "blah");
			expect(ret.client).to.be.null;
		});
		it("should return the user, if it is found", async () => {
			const provider = await getProvider();
			const ret = await provider["bind"]("fox", "blah");
			expect(ret.client).to.not.be.null;
		});
		it("should return the user, if the uid is found", async () => {
			const provider = await getProvider();
			const ret = await provider["bind"]("newfox", "blah");
			expect(ret.client).to.not.be.null;
		});
		it("should return null, if the password is wrong", async () => {
			const provider = await getProvider();
			const ret = await provider["bind"]("newinvalid", "blah");
			expect(ret.client).to.be.null;
		});
		it("should not return a deactivated user", async () => {
			const provider = await getProvider();
			const ret = await provider["bind"]("deactivated", "blah");
			expect(ret.client).to.be.null;
		});
	});
});
