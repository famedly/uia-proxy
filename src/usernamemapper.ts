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

import { UsernameMapperConfig, UsernameMapperModes } from "./config";
import { Log } from "./log";
import * as crypto from "crypto";
import * as base32 from "base32";
import LevelUP from "levelup";
import LevelDOWN from "rocksdb";
import * as t from "io-ts";
import * as E from "fp-ts/Either"
import * as tx from "./fp"

const log = new Log("UsernameMapper");

// tslint:disable-next-line variable-name
export const UsernameMapperEntry = t.intersection([
	t.type({
		/** The current username */
		username: t.string,
	}),
	t.partial({
		/** The immutable persistent ID */
		persistentId: tx.buffer
	}),
]);
export type UsernameMapperEntry = t.TypeOf<typeof UsernameMapperEntry>;

/**
 * Provides mappings from a matrix user's localpart to its uid and persistent
 * ID, where uid refers to the current username in the backing authentication
 * service such as LDAP or OpenID Connect, and persistent ID refers to an
 * immutable persistent identifier associated with the account.
 */
export class UsernameMapper {
	/** Store the configuration and initialize the database */
	public static Configure(config: UsernameMapperConfig) {
		UsernameMapper.config = config;
		UsernameMapper.setupLevelup();
	}

	/**
	 * Transforms the passed uid and persistent ID to a matrix localpart.
	 *
	 * @param username - The account uid as defined in the class description
	 * @param persistentId - The account's persistent immutable ID. Required if
	 * the mapping mode is HMAC_SHA256, optional if it is PLAIN
	 */
	public static async usernameToLocalpart(username: string, persistentId?: Buffer): Promise<string> {
		log.verbose(`Converting username=${username} with persistentId=${persistentId} to localpart using mode=${UsernameMapper.config.mode}`);
		switch (UsernameMapper.config.mode.toLowerCase()) {
			case UsernameMapperModes.HMAC_SHA256.toLowerCase():
				return UsernameMapper.mapUsernameHmacSha256(username, persistentId);
			case UsernameMapperModes.PLAIN.toLowerCase():
				return username;
			default:
				log.error(`Invalid username mapper mode ${UsernameMapper.config.mode}`);
				throw new Error(`Invalid username mapper mode ${UsernameMapper.config.mode}`);
		}
	}

	/**
	 * Looks up the given matrix localpart in the database, returning the
	 * associated uid, and persistent ID if the mapping mode is HMAC_SHA256.
	 */
	public static async localpartToUsername(localpart: string): Promise<UsernameMapperEntry | null> {
		log.verbose(`Looking up username from localpart=${localpart} in mode=${UsernameMapper.config.mode}`);
		switch (UsernameMapper.config.mode.toLowerCase()) {
			// We try to look up the source-username for the localpart
			//  but there is no garantuee of a cache hit
			case UsernameMapperModes.HMAC_SHA256.toLowerCase(): {
				return UsernameMapper.lookupUsernameFromHmacSha256(localpart);
			}
			// In "plain" mode, the username is always known as it is the localpart
			case UsernameMapperModes.PLAIN.toLowerCase(): {
				return {
					username: localpart,
				};
			}
			default: {
				log.error(`Invalid username mapper mode ${UsernameMapper.config.mode}`);
				throw new Error(`Invalid username mapper mode ${UsernameMapper.config.mode}`);
			}
		}
	}

	public static config: UsernameMapperConfig;
	// tslint:disable-next-line no-any
	public static levelup: any;

	/**
	 * Convert the given persistent ID (or uid, as a fallback), to a matrix
	 * localpart, and store the mapping between the localpart and the other ids
	 * in the database
	 */
	private static async mapUsernameHmacSha256(username: string, persistentId?: Buffer): Promise<string> {
		// parse as utf8 if binary attributes are disabled
		const pid = (persistentId && !this.config.binaryPid) ? persistentId.toString() : persistentId;
		const localpart = base32.encode(
			crypto.createHmac("SHA256", UsernameMapper.config.pepper)
				.update(pid || username).digest(),
		).toLowerCase();
		const res: UsernameMapperEntry = {
			username,
		};
		if (persistentId) {
			res.persistentId = persistentId;
		}
		await UsernameMapper.levelup.put(localpart, JSON.stringify(res));
		return localpart;
	}

	/**
	 * The mapped localparts get stored in the Username mapper, this
	 * function attempts to lookup a username from the cache
	 */
	private static async lookupUsernameFromHmacSha256(localpart: string): Promise<UsernameMapperEntry | null> {
		try {
			const res = await UsernameMapper.levelup.get(localpart);
			try {
				const parsed = JSON.parse(res.toString());
				return tx.unwrap(UsernameMapperEntry.decode(parsed));
			} catch (err2) {
				return null;
			}
		} catch (err) {
			if (err.notFound) {
				return null;
			}
			throw err;
		}
	}

	/** Initialize the underlying key-value database */
	private static setupLevelup() {
		UsernameMapper.levelup = LevelUP(LevelDOWN(UsernameMapper.config.folder));
	}
}
