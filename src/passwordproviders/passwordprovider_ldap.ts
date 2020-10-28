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

import { PasswordProviderConfig, IPasswordResponse, IPasswordProvider } from "./passwordprovider";
import { Log } from "../log";
import * as promisifyAll from "util-promisifyall";
import * as ldap from "ldapjs";
import * as ssha from "ssha";
import { UsernameMapper } from "../usernamemapper";

const log = new Log("PasswordProvider Ldap");

interface IPasswordProviderLdapAttributesConfig {
	uid: string;
	enabled: string;
	persistentId: string;
}

interface IPasswordProviderLdapConfig {
	url: string;
	base: string;
	bindDn: string;
	bindPassword: string;
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
		log.info("valid login!");
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
		const searchClient = promisifyAll(await ldap.createClient({
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
		let dn = `${this.config.attributes.uid}=${user},${this.config.base}`;
		log.verbose(`bind: search LDAP for ${dn}`);
		foundUsers = await this.searchAsync(searchClient, dn);
		if (foundUsers.length === 0) {
			log.verbose("Couldn't find user with dn=${dn}, fetching from username mapper...");
			const mapped = await UsernameMapper.localpartToUsername(username);
			if (!mapped) {
				log.info("nothing found in mapper, login failed");
				searchClient.unbind();
				return { client: null, dn: "" };
			}
			if (mapped.persistentId && this.config.attributes.persistentId) {
				log.verbose("Trying via persistentId...");
				user = this.ldapEscape(mapped.persistentId);
				dn = `${this.config.attributes.persistentId}=${user},${this.config.base}`;
				log.verbose(`bind: search via pid: ${dn}, scope: sub`);
				foundUsers = await this.searchAsync(searchClient, this.config.base, {
					scope: "sub",
					filter: `(&(objectClass=*)(${this.config.attributes.persistentId}=${user}))`,
				});
			}
			if (foundUsers.length === 0) {
				log.verbose("Trying via username...");
				user = this.ldapEscape(mapped.username);
				dn = `${this.config.attributes.uid}=${user},${this.config.base}`;
				foundUsers = await this.searchAsync(searchClient, dn);
			}
		}
		if (foundUsers.length !== 1) {
			searchClient.unbind();
			log.warn(`Found more than one entry for ${username}`);
			return { client: null, dn: "" };
		}
		// alright, one last time to set the DN to what it actually is
		dn = `${this.config.attributes.uid}=${foundUsers[0][this.config.attributes.uid]},${this.config.base}`;
		// now check if the user is deactivated
		const isDeactivated = foundUsers[0][this.config.attributes.enabled] === "FALSE";
		// alright, the search client did its job, let's unbind it
		searchClient.unbind();
		if (isDeactivated) {
			// the user is deactivated
			log.verbose(`bind: User ${username} is deactivated`);
			return { client: null, dn: "" };
		}
		const userClient = promisifyAll(await ldap.createClient({
			url: this.config.url,
		}));
		try {
			await userClient.bindAsync(dn, password);
			return { client: userClient, dn };
		} catch (err) {
			log.info("Invalid username/password");
			return { client: null, dn };
		}
	}

	private async verifyLogin(user: string, password: string): Promise<IPasswordProviderLdapUserResult | null> {
		log.verbose(`verifyLogin: start for ${user}`);
		const { client, dn } = await this.bind(user, password);
		if (!client) {
			log.info(`no client for ${dn}, return null`);
			return null;
		}
		// next we search ourself to get all the attributes
		const ret = (await this.searchAsync(client, dn))[0];
		if (!ret) {
			// we were unable to find ourself.....that is odd
			log.warn(`Unable to find our own entry ${dn}`);
			client.unbind();
			return null;
		}
		// we got our full result!
		log.verbose("verifyLogin: Full login successful!");
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
	private async searchAsync(client: ldap.Client, base: string, options: any = {}): Promise<any[]> {
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
			ret.on("end", (result) => {
				const retEntries: any[] = []; // tslint:disable-line no-any
				for (const entry of entries) {
					const attrs = {};
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
