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
import { UsernameMapper } from "../usernamemapper";

const log = new Log("PasswordProvider Ldap");

/** We don't have types for util-promisifyall, so ad-hoc missing functions. */
interface LdapClientAsync extends ldap.Client {
	searchAsync(base: string, options: ldap.SearchOptions): Promise<ldap.SearchCallbackResponse>;
}

interface LdapSearchOptions extends ldap.SearchOptions {
	filter: string;
}

interface IPasswordProviderLdapAttributesConfig {
	uid: string;
	enabled?: string;
	persistentId: string;
}

interface IPasswordProviderLdapConfig {
	url: string;
	base: string;
	bindDn: string;
	bindPassword: string;
	userBase?: string;
	userFilter?: string;
	attributes: IPasswordProviderLdapAttributesConfig;
}

interface IPasswordProviderLdapUserResult {
	username: string;
	persistentId?: string;
}

export class PasswordProvider implements IPasswordProvider {
	public type: string = "ldap";
	private config: IPasswordProviderLdapConfig;

	public async init(config: IPasswordProviderLdapConfig) {
		this.config = config;
	}

	public async checkPassword(username: string, password: string): Promise<IPasswordResponse> {
		log.info(`Checking password for ${username}...`);
		const user = await this.verifyLogin(username, password);
		if (!user) {
			log.info("Invalid username/password");
			return { success: false };
		}
		log.info("Successfully authenticated user");
		if (user.persistentId) {
			// we have a persistent ID! Time to generate the new username
			const newUsername = await UsernameMapper.usernameToLocalpart(username, user.persistentId);
			log.info(`Setting username to ${newUsername}`);
			return {
				success: true,
				username: newUsername,
			};
		}
		return { success: true };
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

	private async bind(
		username: string,
		password: string,
	): Promise<{client: any | null, dn: string}> { // tslint:disable-line no-any
		const searchClient = promisifyAll(ldap.createClient({
			url: this.config.url,
		}));
		try {
			log.verbose("Binding to LDAP using configured bindDN....");
			await searchClient.bindAsync(this.config.bindDn, this.config.bindPassword);
		} catch (err) {
			log.error("Couldn't bind search client", err);
			return { client: null, dn: "" };
		}
		let foundUsers: any[] = []; // tslint:disable-line no-any
		let user = this.ldapEscape(username);
		// Constructing this DN assumes a mapping username -> ldap DN exists,
		// which is typically not true in enterprise environments
		let dn = `${this.config.attributes.uid}=${user},${this.config.userBase}`;
		const searchBase = this.config.userBase ?? this.config.base;
		const getFilterForEntry = (value, key) => `(${key}=${value})`;
		const getFilterForUser = (value) => this.config.userFilter ? this.config.userFilter.replace(/%s/g, value) : getFilterForEntry(value, this.config.attributes.uid);
		const filter = getFilterForUser(user);
		const attributesToQuery = ["dn", this.config.attributes.uid,
			...(this.config.attributes.enabled ?? []),
			...(this.config.attributes.persistentId ?? [])];
		const searchOptions: LdapSearchOptions = {
			scope: "sub",
			filter,
			attributes: attributesToQuery,
		};
		log.verbose(`ldap: search subtree=${searchBase} for user=${user} using filter ${filter}`);
		foundUsers = await this.searchAsync(searchClient, searchBase, searchOptions);
		// If no users are found, the `username` maybe was the localpart, so let's try mapping it back
		if (foundUsers.length === 0) {
			log.verbose(`ldap: couldn't find user with dn=${dn}, fetching from username mapper...`);
			const mapped = await UsernameMapper.localpartToUsername(username);
			// no user found for the localpart, exiting
			if (!mapped) {
				log.verbose(`usernameMapper: no localpart found for username=${username}, login process failed`);
				searchClient.unbind();
				return { client: null, dn: "" };
			}
			log.verbose(`usernameMapper: found cached username=${mapped.username} for localpart=${username}`);
			// Try to locate user in LDAP using the persistentId
			if (mapped.persistentId && this.config.attributes.persistentId) {
				log.verbose(`usernameMapper: trying to find user with persistentId=${this.config.attributes.persistentId}, cached value is '${mapped.persistentId}'`);
				const pidEscaped = this.ldapEscape(mapped.persistentId);
				log.verbose(`ldap: search via pid: ${this.config.attributes.persistentId}=${pidEscaped}, subtree=${searchBase}, scope: sub, filter: ${getFilterForEntry(pidEscaped, this.config.attributes.persistentId)}`);
				foundUsers = await this.searchAsync(searchClient, searchBase, {
					scope: "sub",
					filter: getFilterForEntry(pidEscaped, this.config.attributes.persistentId),
					attributes: attributesToQuery,
				});
			}
			// If a lookup via persistentId didn't succeed, try again with the username inferred from the localpart
			if (foundUsers.length === 0) {
				user = this.ldapEscape(mapped.username);
				log.verbose(`ldap: trying to retrieve dn for username=${user} mapped from localpart=${username}`);
				foundUsers = await this.searchAsync(searchClient, searchBase, {
					scope: "sub",
					filter: getFilterForUser(user),
					attributes: attributesToQuery,
				});
			}
		}
		if (foundUsers.length > 1 || foundUsers.length === 0) {
			searchClient.unbind();
			log.warn(`ldap: Found ${foundUsers.length} entries for ${username}, login not possible`);
			return { client: null, dn: "" };
		}
		log.verbose(`ldap: found one user for ${username} with dn=${foundUsers[0].distinguishedName ?? foundUsers[0].dn}`);
		log.verbose(`ldap: found entry for user=${username}: ${JSON.stringify(foundUsers)}`);
		// alright, one last time to set the DN to what it actually is
		dn = `${foundUsers[0].distinguishedName ?? foundUsers[0].dn}`;
		// now check if the user is deactivated, if an attribute for that is defined
		const isDeactivated = (this.config.attributes.enabled)
			? foundUsers[0][this.config.attributes.enabled] === "FALSE"
			: false;
		// alright, the search client did its job, let's unbind it
		searchClient.unbind();
		if (isDeactivated) {
			// the user is deactivated
			log.verbose(`ldap: User ${username} is deactivated`);
			return { client: null, dn: "" };
		}
		log.verbose(`ldap: Binding as "${dn}" for user=${username}`);
		const userClient = promisifyAll(ldap.createClient({
			url: this.config.url,
		}));
		try {
			await userClient.bindAsync(dn, password);
			log.verbose(`ldap: Bound successfully for user=${username} as ${dn}`);
			return { client: userClient, dn };
		} catch (err) {
			log.info(`ldap: Invalid username/password for dn=${dn}`);
			log.verbose(`ldap: Could not bind for dn=${dn}, error=${err.toString()}`);
			return { client: null, dn };
		}
	}

	private async verifyLogin(user: string, password: string): Promise<IPasswordProviderLdapUserResult | null> {
		log.verbose(`verifyLogin: start for ${user}`);
		const { client, dn } = await this.bind(user, password);
		if (!client) {
			log.info(`verifyLogin: Could not find or authenticate ${user}, aborting`);
			log.verbose(`verifyLogin: found dn=${dn} for user=${user}`);
			return null;
		}
		// next we search ourself to get all the attributes
		const ret = (await this.searchAsync(client, dn))[0];
		if (!ret) {
			// we were unable to find ourself.....that is odd
			// TODO: refactor: an ldap user might not be able to see all their own attributes,
			// but the service user might (example: GUIDs) -> this whole block needs to be refactored
			log.warn(`verifyLogin: unable to find entry dn=${dn} for user=${user}`);
			client.unbind();
			return null;
		}
		// we got our full result!
		log.verbose(`verifyLogin: login for user=${user} succeeded with dn=${dn}`);
		const result = {
			username: ret[this.config.attributes.uid],
			persistentId: ret[this.config.attributes.persistentId],
		} as IPasswordProviderLdapUserResult;
		client.unbind();
		return result;
	}

	private ldapEscape(str: string): string {
		return str.replace(/[^a-z0-9-.=_\/]/g, ""); // protect against injection attacks
	}

	// tslint:disable-next-line no-any
	private async searchAsync(client: LdapClientAsync, base: string, options: LdapSearchOptions = {} as LdapSearchOptions): Promise<any[]> {
		return new Promise(async (resolve, reject) => {
			const ret = await client.searchAsync(base, options);
			const entries: any[] = []; // tslint:disable-line no-any
			ret.on("searchEntry", (e) => {
				entries.push(e);
			});
			ret.on("error", (err) => {
				if (err instanceof ldap.NoSuchObjectError) {
					resolve([]);
				} else {
					reject(err);
				}
			});
			ret.on("end", (_result) => {
				const retEntries: any[] = []; // tslint:disable-line no-any
				for (const entry of entries) {
					const attrs = {
						dn: entry.objectName,
					};
					for (const attr of entry.attributes) {
						// TODO: support array value attributes
						attrs[attr.type] = attr._vals[0].toString();
					}
					retEntries.push(attrs);
				}
				resolve(retEntries);
			});
		});
	}
}
