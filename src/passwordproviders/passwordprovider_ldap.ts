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

import { IPasswordResponse, IPasswordProvider } from "./passwordprovider";
import { Log } from "../log";
import promisifyAll from "util-promisifyall";
import * as ldap from "ldapjs";
import * as ssha from "ssha";
import * as t from "io-ts";
import { UsernameMapper } from "../usernamemapper";
import { Buffer } from "node:buffer"
import { unwrap } from "../fp";

const log = new Log("PasswordProvider Ldap");

/** We don't have types for util-promisifyall, so ad-hoc missing functions. */
interface LdapClientAsync extends ldap.Client {
	searchAsync(base: string, options: ldap.SearchOptions): Promise<ldap.SearchCallbackResponse>;
	modifyAsync(name: string, change: ldap.Change): Promise<void>,
}

/** Data extracted from an LDAP search query */
interface LdapSearchResult {
	/** The distinguished name of an Entry */
	dn: string | null;
	/** The attributes of the entry in raw byte form */
	raw: {[key: string]: Buffer | undefined};
	/** The attributes of the entry decoded as utf8. Invalid byte sequences are replaced with U+FFFD � */
	utf8: {[key: string]: string | undefined};
}

/** Mapping from LDAP attributes to known properties like display name */
class LdapAttributesConfig {
	/** The username people can log in as */
	uid: string;
	enabled?: string;
	/** The display name for the user */
	displayname?: string;
	/** Whether the user is admin */
	admin?: string;
	/** The persistent ID to create mxid hashes of */
	persistentId: string;

	static codec = t.intersection([
		t.type({
			uid: t.string,
			persistentId: t.string,
		}),
		t.partial({
			enabled: t.string,
			displayname: t.string,
			admin: t.string,
		})
	])

	constructor(init: t.TypeOf<typeof LdapAttributesConfig.codec>) {
		this.uid = init.uid;
		this.enabled = init.enabled;
		this.displayname = init.displayname;
		this.persistentId = init.persistentId;
	}
}

class LdapConfig {
	/** The URL the LDAP is reachable at */
	url: string;
	/** The base DN of the LDAP */
	base: string;
	/** The DN of the search user to initially bind with */
	bindDn: string;
	/** The password of the search user */
	bindPassword: string;
	/** The base DN for all user searches */
	userBase?: string;
	/** The filter to apply when searching for a user entry */
	userFilter?: string;
	/** The filter to use when searching using peristentID */
	pidFilter?: string;
	/** Mapping from LDAP attributes to known properties like display name */
	attributes: LdapAttributesConfig;
	/** Allow connection when the server certificate is unknown */
	allowUnauthorized?: boolean;

	static codec = t.intersection([
		t.type({
			url: t.string,
			base: t.string,
			bindDn: t.string,
			bindPassword: t.string,
			attributes: LdapAttributesConfig.codec,
		}),
		t.partial({
			userBase: t.string,
			userFilter: t.string,
			pidFilter: t.string,
			allowUnauthorized: t.boolean,
		})
	]);

	constructor(init: t.TypeOf<typeof LdapConfig.codec>) {
		this.url = init.url;
		this.base = init.base;
		this.bindDn = init.bindDn;
		this.bindPassword = init.bindPassword;
		this.userBase = init.userBase;
		this.userFilter = init.userFilter;
		this.pidFilter = init.pidFilter;
		this.attributes = init.attributes;
		this.allowUnauthorized = init.allowUnauthorized;
	}

}

/** The user data extracted from an LDAP search result */
interface IPasswordProviderLdapUserResult {
	username: string;
	persistentId?: Buffer;
	displayname?: string;
	admin?: boolean;
}

export class PasswordProvider implements IPasswordProvider {
	public type: string = "ldap";
	private config!: LdapConfig;

	public async init(config: unknown) {
		this.config = new LdapConfig(unwrap(LdapConfig.codec.decode(config)));
	}

	/** Validate the given credatials */
	public async checkUser(username: string, password: string): Promise<IPasswordResponse> {
		log.info(`Checking password for ${username}...`);
		const user = await this.getLoginInfo(username, password);
		if (!user) {
			log.info("Invalid username/password");
			return { success: false };
		}
		log.info("Successfully authenticated user");
		if (user.persistentId) {
			// we have a persistent ID! Time to generate the new username
			const newUsername = await UsernameMapper.usernameToLocalpart(user.username, user.persistentId);
			log.info(`Setting username to ${newUsername}`);
			return {
				success: true,
				username: newUsername,
				displayname: user.displayname
			};
		}
		return { success: true, displayname: user.displayname };
	}

	public async changePassword(username: string, oldPassword: string, newPassword: string): Promise<boolean> {
		log.info(`Changing password for ${username}...`);
		const { client, dn } = await this.bind(username, oldPassword);
		if (!client) {
			return false;
		}
		// alright, we are logged in now. Time to change that password!
		const modification = {
			userPassword: ssha.create(newPassword),
		};
		const change = new ldap.Change({
			operation: "replace",
			modification,
		});
		try {
			await client.modifyAsync(dn, change);
		} catch (err) {
			log.warn("Failed to change password", err);
			client.unbind();
			return false;
		}
		log.info("Password changed successfully!");
		client.unbind();
		return true;
	}

	/**
	 * Try to find and then bind to an LDAP user with the given username and password.
	 *
	 * The username can be either the uid attribute of the LDAP user, or the
	 * localpart of the mxid of the matrix user. If an mxid is given, the
	 * persistent ID will be looked up from the username mapper, and then used
	 * to search for the user.
	 */
	private async bind(
		username: string,
		password: string,
	): Promise<{client: LdapClientAsync | null, dn: string}> {
		const searchClient = promisifyAll(ldap.createClient({
			url: this.config.url,
			tlsOptions: {rejectUnauthorized: !this.config.allowUnauthorized},
		}));
		try {
			log.verbose("bind: Binding to LDAP using configured bindDN....");
			await searchClient.bindAsync(this.config.bindDn, this.config.bindPassword);
		} catch (err) {
			log.error("bind: Couldn't bind search client", err);
			return { client: null, dn: "" };
		}
		let user = this.ldapEscape(username);
		const searchBase = this.config.userBase ?? this.config.base;
		const filter = this.getFilterForUser(user);
		const attributes = this.attributesToQuery();
		log.verbose("bind: Querying for the attributes", attributes);

		// Search for a user with a uid attribute of username
		log.verbose(`bind: search subtree=${searchBase} for user=${user} using filter=${filter}`);
		let foundUsers: LdapSearchResult[] = [];
		try {
			foundUsers = await this.searchAsync(searchClient, searchBase, {
				scope: "sub",
				filter,
				attributes,
			});
		} catch (err) {
			log.error(`Searching for user=${user} failed:`, err)
			return {client: null, dn: ""};
		}

		// If no users are found, look up `username` in the mapper in case it's an mxid
		if (foundUsers.length === 0) {
			log.verbose(`bind: couldn't find user with previous search, looking up mxid in username mapper...`);
			const mapped = await UsernameMapper.localpartToUsername(username);
			if (!mapped) {
				// no user found for the localpart, exiting
				log.verbose(`bind: no username found for localpart=${username}, login process failed`);
				searchClient.unbind();
				return { client: null, dn: "" };
			}

			// Try to locate the user in LDAP using the persistentId in the mapping
			log.verbose(`bind: Found mapping to username=${mapped.username} for localpart=${username}`);
			if (mapped.persistentId && this.config.attributes.persistentId) {
				// Escape the pid so it can be used in a search filter
				const pidEscaped = UsernameMapper.config.binaryPid
					? this.ldapEscapeBinary(mapped.persistentId)
					: this.ldapEscape(mapped.persistentId.toString());
				const pidFilter = this.getFilterForPid(pidEscaped);
				log.verbose(
					`bind: search via pid=${this.config.attributes.persistentId}=${pidEscaped}`,
					`subtree=${searchBase}`,
					`scope=sub`,
					`filter=${pidFilter}`
				);
				try {
					foundUsers = await this.searchAsync(searchClient, searchBase, {
						scope: "sub",
						filter: pidFilter,
						attributes,
					});
				} catch (err) {
					log.error("bind: Searching for user with binary id failed:", err.message ?? err)
				}
			}

			// If a lookup via persistentId didn't succeed, try again with the username stored in the mapping
			if (foundUsers.length === 0) {
				user = this.ldapEscape(mapped.username);
				log.verbose(`bind: trying to retrieve dn for username=${user} mapped from localpart=${username}`);
				try {
					foundUsers = await this.searchAsync(searchClient, searchBase, {
						scope: "sub",
						filter: this.getFilterForUser(user),
						attributes,
					});
				} catch (err) {
					log.error("bind: Search failed: ", err.message ?? err)
				}
			}
		}

		// The search user is no longer needed
		searchClient.unbind();

		if (foundUsers.length !== 1) {
			log.warn(`bind: Found ${foundUsers.length} entries for ${username}, login not possible`);
			return { client: null, dn: "" };
		}

		const foundUser = foundUsers[0];
		log.debug(`bind: found entry for user=${username}:`, foundUser);

		const dn = foundUser.utf8.distinguishedName ?? foundUser.utf8.dn ?? foundUser.dn;
		if (!dn) {
			log.error(`bind: Missing dn for username=${username}`)
			return { client: null, dn: "" }
		}
		log.verbose(`bind: found one user for ${username} with dn=${dn}`);

		// now check if the user is deactivated, if an attribute for that is defined
		const isDeactivated = (this.config.attributes.enabled)
			? foundUser.utf8[this.config.attributes.enabled] === "FALSE"
			: false;
		if (isDeactivated) {
			// the user is deactivated
			log.verbose(`ldap: User ${username} is deactivated`);
			return { client: null, dn: "" };
		}

		// We've found the DN of the user, try to bind to it with `password` to validate the credentials
		log.verbose(`bind: Binding as dn="${dn}" for user=${username}`);
		const userClient = promisifyAll(ldap.createClient({
			url: this.config.url,
			tlsOptions: {rejectUnauthorized: !this.config.allowUnauthorized},
		}));
		try {
			await userClient.bindAsync(dn, password);
			log.verbose(`bind: Bound successfully for user=${username} as ${dn}`);
			return { client: userClient, dn };
		} catch (err) {
			log.info(`bind: Invalid username/password for dn=${dn}`);
			log.verbose(`bind: Could not bind for dn=${dn}, error=${err.message ?? err}`);
			return { client: null, dn };
		}
	}

	/**
	 * Authorize the user with the given user against the directory, then
	 * retrieve relevant information about the user from the directory
	 */
	private async getLoginInfo(user: string, password: string): Promise<IPasswordProviderLdapUserResult | null> {
		log.verbose(`getLoginInfo: start for ${user}`);
		const { client, dn } = await this.bind(user, password);
		if (!client) {
			log.info(`getLoginInfo: Could not find or authenticate ${user}, aborting`);
			return null;
		}
		log.verbose(`getLoginInfo: found dn=${dn} for user=${user}`);
		// next we search ourself to get all the attributes
		let search: LdapSearchResult | undefined;
		try {
			search = (await this.searchAsync(client, this.ldapReencode(dn)))[0]
		} catch (err) {
			log.error(`getLoginInfo: Searching for own user failed`, err)
		}

		if (!search) {
			// we were unable to find ourself.....that is odd
			// TODO: refactor: an ldap user might not be able to see all their own attributes,
			// but the service user might (example: GUIDs) -> this whole block needs to be refactored
			// TODO: This could be handled by making bind return its foundUser variable, and skipping
			// the extra search we did in this function entirely when the search user should be used
			// to get attributes
			log.warn(`getLoginInfo: unable to find entry dn=${dn} for user=${user}`);
			client.unbind();
			return null;
		}
		// we got our full result!
		log.verbose(`getLoginInfo: login for user=${user} succeeded with dn=${dn}`);

		const displayname = this.config.attributes.displayname && search.utf8[this.config.attributes.displayname];

		let admin: boolean | undefined;
		if (this.config.attributes.admin) {
			const adminAttribute = search.utf8[this.config.attributes.admin];
			switch (adminAttribute) {
				case "TRUE": admin = true; break;
				case "FALSE": admin = false; break;
				default: {
					log.warn(`getLoginInfo: Unexpected value for binary attribute: ${adminAttribute}`);
					admin = undefined;
				};
			}
		}

		const username = search.utf8[this.config.attributes.uid];
		if (!username) {
			log.error(`getLoginInfo: Search result for username=${username} had no username`)
			return null;
		}
		const loginInfo: IPasswordProviderLdapUserResult = {
			username,
			persistentId: search.raw[this.config.attributes.persistentId],
			displayname,
			admin,
		};
		client.unbind();

		return loginInfo;
	}

	/**
	 * Resets the username mapping of the user with the given persistentId.
	 * Only works when the search user can access the right attributes.
	 */
	public async resetMapping(persistentId: Buffer): Promise<void> {
		const searchClient = promisifyAll(ldap.createClient({
			url: this.config.url,
			tlsOptions: {rejectUnauthorized: !this.config.allowUnauthorized},
		}));
		log.verbose("resetMapping: Binding to service user");
		await searchClient.bindAsync(this.config.bindDn, this.config.bindPassword);

		const searchBase = this.config.userBase ?? this.config.base;
		const attributes = ["dn", this.config.attributes.uid, this.config.attributes.persistentId];
		const pidEscaped = UsernameMapper.config.binaryPid
			? this.ldapEscapeBinary(persistentId)
			: this.ldapEscape(persistentId.toString());

		const foundUsers = await this.searchAsync(searchClient, searchBase, {
			scope: "sub",
			filter: this.getFilterForPid(pidEscaped),
			attributes,
		});
		if (foundUsers.length !== 1) {
			log.warn(`resetMapping: Expected 1 returned user, got ${foundUsers.length}`);
			return;
		}
		const uid = foundUsers[0].utf8[this.config.attributes.uid];
		if (!uid) {
			log.warn("resetMapping: uid attribute missing for", pidEscaped);
			return;
		};

		// Reset the mapping
		await UsernameMapper.usernameToLocalpart(uid, persistentId);

	}

	/** Removes characters that are not a-z, 0-9, -, ., =, _, or / from a string */
	private ldapEscape(str: string): string {
		return str.replace(/[^a-z0-9-.=_\/]/g, ""); // protect against injection attacks
	}

	/** Converts the contents of a Buffer to its escaped LDAP hex representation */
	private ldapEscapeBinary(buffer: Buffer): string {
		let escaped = buffer.reduce((str, byte) => {
			switch (this.shouldEscape(byte)) {
				case "byte":
					// tslint:disable-next-line no-magic-numbers
					return str + `\\${byte.toString(16).toLowerCase().padStart(2, '0')}`;
				case "escape":
					return str + `\\${String.fromCodePoint(byte)}`
				case "none":
					return str + String.fromCodePoint(byte);
			}
		}, "")
		escaped = escaped.replace(/^ /, "\\20")
		escaped = escaped.replace(/ $/, "\\20")
		return escaped;
	}

	/** Takes an ldap escaped string from a foreign source an re-encodes it in the format ldapjs expects */
	private ldapReencode(str: string): string {
		return str
			.replace(/\\23/gi, "\\#")
			.replace(/\\2C/gi, "\\,")
			.replace(/\\2B/gi, "\\+")
			.replace(/\\22/gi, "\\\"")
			.replace(/\\5C/gi, "\\\\")
			.replace(/\\3C/gi, "\\<")
			.replace(/\\3E/gi, "\\>")
			.replace(/\\3B/gi, "\\;")
			.replace(/\\3D/gi, "\\=");
	}

	/**
	 * Returns how the given byte should be represented in a filter string.
	 * "none" means the byte can be used directly, "escape" means it should be
	 * preceded by a backslash, "byte" means it should be converted to hex
	 * representation, i.e. a backslash followed by the hex digits of the
	 * byte, e.g. 0x3F becomes \3F.
	 *
	 * While not required, all ASCII control characters are byte escaped for
	 * the sake of human readability. Other non-mandatory characters are
	 * escaped to guard against servers that are stricter about the filter
	 * characters they accept than what the RFC describes
	 *
	 * See Section 3 of RFC4515 for further explanation:
	 * https://www.rfc-editor.org/rfc/rfc4515#section-3
	 */
	private shouldEscape(byte: number): "escape" | "byte" | "none" {
		// tslint:disable no-magic-numbers
		// precede #, ,, +, ", \, <, >, ;, = with backlash
		if ([0x23, 0x2C, 0x2B, 0x22, 0x5C, 0x3C, 0x3E, 0x3B, 0x3D].includes(byte)) {
			return "escape"
		// byte escape non-ascii and control characters
		} else if (byte >= 0x80 || byte < 0x20) {
			return "byte"
		} else {
			return "none"
		}
		// tslint:enable no-magic-numbers
	}

	/** Get a list of the attributes to fetch from the directory server */
	attributesToQuery(): string[] {
		const attributes = ["dn"];
		for (const value of Object.values(this.config.attributes)) {
			if (typeof value === "string") {
				attributes.push(value)
			}
		}
		return attributes;
	}

	/** Default search filter */
	getFilterForEntry(value: string, key: string): string {
		return `(${key}=${value})`;
	}

	/**
	 * Returns a search filter that should return an entry for the user with the given persistent ID
	 * @param persistentId - LDAP filter-escaped representation of a persistent ID
	 */
	getFilterForPid(persistentId: string): string {
		if (this.config!.pidFilter) {
			return this.config!.pidFilter.replace(/%s/g, persistentId);
		} else {
			return this.getFilterForEntry(persistentId, this.config!.attributes.persistentId);
		}
	}

	/**
	 * Returns a search filter that should return an entry for the user with the given uid
	 * @param user - LDAP filter-escaped representation of a user ID
	 */
	getFilterForUser(user: string): string {
		if (this.config.userFilter) {
			return this.config!.userFilter.replace(/%s/g, user);
		} else {
			return this.getFilterForEntry(user, this.config!.attributes.uid);
		}
	}

	/**
	 * Perform a search against the directory server, extracting relevant information
	 * @param client - The promisifyAll'd LDAP client to perform the search with. Must have been bind'ed already
	 * @param base - The search base
	 * @param options - Search options, such as search filter
	 */
	private async searchAsync(client: LdapClientAsync, base: string, options: ldap.SearchOptions = {}): Promise<LdapSearchResult[]> {
		return new Promise(async (resolve, reject) => {
			const search = await client.searchAsync(base, options);
			const entries: ldap.SearchEntry[] = [];
			search.on("searchEntry", (e) => {
				entries.push(e);
			});
			search.on("error", (err) => {
				if (err instanceof ldap.NoSuchObjectError) {
					resolve([]);
				} else {
					reject(err);
				}
			});
			search.on("end", (_result) => {
				const searchEntries: LdapSearchResult[] = [];
				for (const entry of entries) {
					const attrs = {
						dn: entry.objectName,
						utf8: {},
						raw: {},
					};
					for (const attr of entry.attributes) {
						// TODO: support array value attributes
						const type = attr.type;
						attrs.utf8[type] = attr.buffers[0].toString();
						attrs.raw[type] = attr.buffers[0];
					}
					searchEntries.push(attrs);
				}
				resolve(searchEntries);
			});
		});
	}
}
