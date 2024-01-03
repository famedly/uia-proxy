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
import { Log } from "../../src/log";
import { locate } from "func-loc"

const log = new Log("test_ldap")
// we are a test file and thus our linting rules are slightly different
/* eslint-disable @typescript-eslint/no-unused-expressions, @typescript-eslint/no-explicit-any, no-magic-numbers, @typescript-eslint/dot-notation */

function ldapDecode(str: string): string {
	let sum = "";
	for (let i = 0; i < str.length; i++) {
		if (str[i] === "\\" && str.length >= i + 3) {
			try {
				const byte = parseInt(str[i + 1] + str[i + 2], 16);
				sum += String.fromCodePoint(byte);
				i += 2;
			} catch (e) {
				sum += str[i];
			}
		} else {
			sum += str[i];
		}
	}
	return sum;
}

/**
 * Faked error, emited asyncronuously on the real Client
 */
const FAKED_ERROR = {
	errno: -104,
	code: "ECONNRESET",
	syscall: "read (🙀 It looks like some fox chewed through the LDAP server cable)."
};

/** Storage for the callbacks, which our CUT should register by the real ldap.Client for 'connectError' event. */
const connectErrorCallbacks: ((...args: any[]) => void) [] = [];

/**
 * Simulates socket error on the client by firing all registered callbacks.
 * @param onInvocation callback, triggered after each listener invocation.
 * @returns the number of effectivelly called callbacks.
 */
function triggerAllErrors(onInvocation: () => void): number {
	// Note that if no listeners are registered, nothing will be triggered.
	connectErrorCallbacks.forEach( async (fn) => {
		const origin = await locate(fn); // locate callback function via Node's inspector
		log.verbose(`Mock client: triggering callback ${typeof fn} ${origin.path} ${origin.line}:${origin.column}`);
		// Invoke callback, passing some faked ldapjs.Error structure.
		// We assume that the real Client will do this, if some
		// socket/connection related error happens asynchronuosly.
		fn(FAKED_ERROR);

		// Call invocation callback
		if (typeof onInvocation === "function") {
			onInvocation();
		} else {
			log.verbose(`triggerAllErrors() No callback found, nothing to call`);
		}
	});
	log.verbose(`triggerAllErrors() found ${connectErrorCallbacks.length} callback(s).`);
	return connectErrorCallbacks.length;
}

async function getProvider(attributeOverride?: { uid?: string; persistentId?: string; enabled?: string; simulateErrorOnBind?: any; simulateErrorOnSearch?: any; onInvocation?: any; displayname?: string; } | undefined) {
	// Empty the array, which stores the registered callbacks
	if (connectErrorCallbacks.length > 0) {
		log.verbose(`getProvider(): emptying callback array of current length ${connectErrorCallbacks.length}`);
		connectErrorCallbacks.length = 0; // This seems to be the fastest method
	}
	// Mock and extend the real Client
	const client = {
		// Mock callback subscription of the real client, for now just for the 'connectError' event
		on(eventName: string | symbol, listener: (...args: any[]) => void): EventEmitter {
			switch( String(eventName) ) {
				case "connectError":
					if (!connectErrorCallbacks.includes(listener)) {
						log.debug(`Registering event listener ${typeof listener}_${connectErrorCallbacks.length + 1} for 'connectError'.`);
						connectErrorCallbacks.push(listener);
					} else {
						log.warn(`Listener already registered for 'connectError', ignoring...`);
					}
					break;
				default:
					throw Error(`Unknown event '${String(eventName)}'. For now this mock doesn't support any events other than 'connectError'`);
			}
			return this; // We are pretending to be an EventEmitter, so we can return just "this"
		},
		// -----------------------------------------------------------------------
		bindAsync: async (user: string) => {
			// - - - - - Mocked logic of bindAsync() - - - - -
			const fakeInvalidUser = user.match(/^(uid=(new)?invalid)/);
			if (fakeInvalidUser != null) {
				throw new Error("Invalid login");
			}
			// - - - - - Simulate socket error during bind phase? - - - - - -
			if (attributeOverride?.simulateErrorOnBind) {
				if (triggerAllErrors(attributeOverride?.onInvocation) < 1) {
					log.warn(`Mock client bindAsync(): throwing Error, to simulate unhandled async error on the client.`);
					throw Error("Mock client bindAsync(): unhandled error, no listener for 'connectError' found.");
				} else {
					log.debug(`Mock client bindAsync(): will not throw an Error, because there are registered callback(s).`);
				}
			}
		},
		unbind: () => { },
		searchAsync: async (base: string, options = {} as any) => {
			// - - - - - Mocked logic of searchAsync() - - - - -
			base = ldapDecode(base);
			const ret = new EventEmitter();
			const SEARCH_TIME = 50;
			setTimeout(() => {
				if (options.scope === "sub") {
					const matches = options.filter.match(/\(uid=(\w+)\)/);
					const name = matches ? matches[1] : null;
					const enabled = (name === 'deactivated') ? "FALSE" : "TRUE";
					ret.emit("searchEntry", { objectName: `uid=${name},${config.userBase}`, attributes: [
						// the typings for ldapjs forgot to define the constructor for Attribute
						new (ldapjs as any).Attribute({
							type: "dn",
							vals: [`uid=${name},${config.userBase}`],
						}),
						new (ldapjs as any).Attribute({
							type: "uid",
							vals: ["name"],
						}),
						new (ldapjs as any).Attribute({
							type: "persistentId",
							vals: ["pid" + name],
						}),
						new (ldapjs as any).Attribute({
							type: "enabled",
							vals: [enabled],
						}),
					]});
				} else if (base === "cn=deactivatedUsers,ou=groups,dc=famedly,dc=de") {
					if (options.filter !== "(&(objectClass=*)(member=cn=deactivated,dc=localhost,dc=localdomain))") {
						ret.emit("error", new ldapjs.NoSuchObjectError());
					} else  {
						ret.emit("searchEntry", { attributes: [
							new (ldapjs as any).Attribute({
								type: "member",
								vals: ["cn=deactivated,dc=localhost,dc=localdomain"],
							}),
						]});
					}
				} else if (base.match(/uid=(fox),/)) {
					ret.emit("searchEntry", { attributes: [
						new (ldapjs as any).Attribute({
							type: "uid",
							vals: ["fox"],
						}),
						new (ldapjs as any).Attribute({
							type: "persistentId",
							vals: ["pidfox"],
						}),
						new (ldapjs as any).Attribute({
							type: "displayname",
							vals: ["Pixel"],
						}),
					]});
				} else if (base.match(/uid=(bat),/)) {
					ret.emit("searchEntry", { attributes: [
						new (ldapjs as any).Attribute({
							type: "uid",
							vals: ["bat"],
						}),
						new (ldapjs as any).Attribute({
							type: "persistentId",
							vals: ["pidbat"],
						}),
					]}); }
				else if (base.match(/uid=deactivated,/)) {
					ret.emit("searchEntry", { attributes: [
						new (ldapjs as any).Attribute({
							type: "uid",
							vals: ["deactivated"],
						}),
						new (ldapjs as any).Attribute({
							type: "persistentId",
							vals: ["piddeactivated"],
						}),
						new (ldapjs as any).Attribute({
							type: "enabled",
							vals: ["FALSE"],
						}),
					]});
				} else {
					ret.emit("error", new ldapjs.NoSuchObjectError());
				}
				ret.emit("end");

				// - - - - - Simulate socket error during SEARCH phase? - - - - - -
				if (attributeOverride?.simulateErrorOnSearch) {
					if (triggerAllErrors(attributeOverride?.onInvocation) < 1){
						log.warn(`Mock client searchAsync(): throwing Error, to simulate unhandled async error on the client.`);
						throw new Error("Mock client searchAsync(): unhandled error. To prevent this Error from being thrown, the Provider should register a handler for 'connectError'.");
					} else {
						log.debug(`Mock client searchAsync(): will not throw an Error, because there are registered callback(s).`);
					}
				}
			}, SEARCH_TIME);
			return ret;
		},
	} as any;
	// eslint-disable-next-line @typescript-eslint/naming-convention
	const PasswordProvider = proxyquire.load("../../src/passwordproviders/passwordprovider_ldap", {
		"ldapjs": {
			createClient: () => {
				return client;
			},
		},
		"../usernamemapper": { UsernameMapper: {
			usernameToLocalpart: async (username: string, persistentId?: Buffer) => {
				if (persistentId) {
					return "new" + persistentId;	// eslint-disable-line @typescript-eslint/restrict-plus-operands
				}
				return "new" + username;
			},
			localpartToUsername: async (localpart: string) => {
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
		displayname: "displayname",
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
	};
	await provider.init(config);
	return provider;
}

describe("PasswordProvider ldap", () => {
	describe("clientErrorHandling", () => {
		it("both bind().searchClient and bind().userClient should handle the 'connectError' event during BIND phase.", async () => {
			let invocationCounter: number = 0;
			// Get Provider, those underlying Client will simulate an async socket error
			const provider = await getProvider({
				uid: "uid",
				persistentId: "persistentId",
				enabled: "enabled",
				simulateErrorOnBind: true, 		// <- Important are only this two,
				simulateErrorOnSearch: true,	// <- the rest are placeholders.
				onInvocation (): void {
					invocationCounter += 1;
				},
			});

			const ret = await provider["bind"]("fox", "blah");
			log.debug(`Count after ${invocationCounter}`)
			expect(invocationCounter).to.be.equal(2);
		});
		it("both bind().searchClient and bind().userClient should handle the 'connectError' event during SEARCH phase.", async () => {
			let invocationCounter: number = 0;
			// Get Provider, those underlying Client will simulate an async socket error
			const provider = await getProvider({
				uid: "uid",
				persistentId: "persistentId",
				enabled: "enabled",
				simulateErrorOnBind: true, 	// <- Important are only this two,
				simulateErrorOnSearch: true,	// <- the rest are placeholders.
				onInvocation (): void {
					invocationCounter += 1;
				},
			});

			const ret = await provider["checkUser"]("fox", "blah");
			log.debug(`Count after ${invocationCounter}`)
			expect(invocationCounter).to.be.equal(6);
		});
	});
	describe("checkUser", () => {
		it("should deny, should the login fail", async () => {
			const provider = await getProvider();
			provider["getLoginInfo"] = async () => null;
			const ret = await provider.checkUser("fox", "secret");
			expect(ret.success).to.be.false;
		});
		it("should accept, should the login be valid", async () => {
			const provider = await getProvider();
			provider["getLoginInfo"] = async () => {
				return { username: "fox" };
			};
			const ret = await provider.checkUser("fox", "secret");
			expect(ret.success).to.be.true;
			expect(ret.username).to.be.undefined;
		});
		it("should apply a new username, if a persistent id is present", async () => {
			const provider = await getProvider();
			provider["getLoginInfo"] = async () => {
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
			expect(ret.persistentId.toString("utf8")).to.equal("pidfox");
			expect(ret.displayname).to.equal("Pixel");
		});
		it("should return the result without displayname, if displayname isn't defined", async () => {
			const provider = await getProvider();
			const ret = await provider["getLoginInfo"]("bat", "blah");
			expect(ret.username).to.equal("bat");
			expect(ret.persistentId.toString("utf8")).to.equal("pidbat");
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
			expect(ret.persistentId.toString("utf8")).to.equal("pidfox");
			expect(ret.displayname).to.be.undefined;
		});
	});
	describe("bind", () => {
		it("should return null, if the user is not found", async () => {
			const provider = await getProvider();
			const ret = await provider["bind"]("invalid", "blah");
			log.info("should be null" + JSON.stringify(ret))
			expect(ret.client).to.be.null;
		});
		it("should return the user, if it is found", async () => {
			const provider = await getProvider();
			const ret = await provider["bind"]("fox", "blah");
			log.info("return the user, if it is found" + JSON.stringify(ret))
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
			log.info("wrong password" + JSON.stringify(ret))
			expect(ret.client).to.be.null;
		});
		it("should not return a deactivated user", async () => {
			const provider = await getProvider();
			const ret = await provider["bind"]("deactivated", "blah");
			expect(ret.client).to.be.null;
		});
	});
	describe("escape", () => {
		it("should string escape correctly", async () => {
			const provider = await getProvider();
			const escaped = provider["ldapEscape"]("Hello#\\'@$!")
			expect(escaped).to.equal("Hello@");
		})
		it("should binary escape correctly", async () => {
			const provider = await getProvider();
			let escaped = provider["ldapEscapeBinary"](Buffer.from(" Hello #,+\"\\<>;\x0A\x0D= "));
			expect(escaped).to.equal("\\20Hello \\#\\,\\+\\\"\\\\\\<\\>\\;\\0a\\0d\\=\\20");

			escaped = provider["ldapEscapeBinary"](Buffer.from([0x28, 0x29, 0x02, 0x4d, 0x65, 0x6f, 0x77, 0x40, 0xbf, 0x90, 0x39, 0xff, 0x7a, 0xf0, 0xf1, 0x00]));
			expect(escaped).to.equal("\\(\\)\\02Meow@\\bf\\909\\ffz\\f0\\f1\\00");
		})
	})
});
