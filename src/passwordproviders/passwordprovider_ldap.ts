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
import { sha512 } from "js-sha512";

const log = new Log("PasswordProvider Ldap");

interface IPasswordProviderLdapAttributesConfig {
	uid: string;
	persistentId: string;
}

interface IPasswordProviderLdapConfig {
	url: string;
	base: string;
	mxidPepper: string;
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
			// we have a persistent ID! Time to pepper this and use a new username!
			const newUsername = sha512.hmac(this.config.mxidPepper, user.persistentId);
			log.info(`Setting username to ${newUsername}`);
			return {
				success: true,
				username: newUsername,
			};
		}
		return { success: true };
	}

	public async verifyLogin(user: string, password: string): Promise<IPasswordProviderLdapUserResult | null> {
		user = this.ldapEscape(user);
		const client = promisifyAll(await ldap.createClient({
			url: this.config.url,
		}));
		// first we try to log in
		const dn = `${this.config.attributes.uid}=${user},${this.config.base}`;
		try {
			log.verbose("Attempting to log in...");
			await client.bindAsync(dn, password);
		} catch (err) {
			log.verbose("Login failed!");
			client.unbind(); // make sure we unbind anyways
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
		log.verbose("Full login successful!");
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
