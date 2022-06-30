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

const log = new Log("UsernameMapper");

export interface IUsernameMapperResult {
	username: string;
	persistentId?: Buffer;
}

export class UsernameMapper {
	public static Configure(config: UsernameMapperConfig) {
		UsernameMapper.config = Object.assign(new UsernameMapperConfig(), config);
		UsernameMapper.setupLevelup();
	}

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

	public static async localpartToUsername(localpart: string): Promise<IUsernameMapperResult | null> {
		log.verbose(`Looking up username from localport=${localpart} in mode=${UsernameMapper.config.mode}`);
		switch (UsernameMapper.config.mode) {
			// We try to look up the source-username for the localpart
			//  but there is no garantuee of a cache hit
			case UsernameMapperModes.HMAC_SHA256: {
				return UsernameMapper.lookupUsernameFromHmacSha256(localpart);
			}
			// In "plain" mode, the username is always known as it is the localpart
			case UsernameMapperModes.PLAIN: {
				return {
					username: localpart,
				} as IUsernameMapperResult;
			}
		}
	}

	public static config: UsernameMapperConfig;
	// tslint:disable-next-line no-any
	private static levelup: any;

	private static async mapUsernameHmacSha256(username: string, persistentId?: Buffer): Promise<string> {
		// parse as utf8 if binary attributes are disabled
		const pid = (persistentId && !this.config.binaryPid) ? persistentId.toString() : persistentId;
		const localpart = base32.encode(
			crypto.createHmac("SHA256", UsernameMapper.config.pepper)
				.update(pid || username).digest(),
		).toLowerCase();
		const res = {
			username,
		} as IUsernameMapperResult;
		if (persistentId) {
			res.persistentId = persistentId;
		}
		await UsernameMapper.levelup.put(localpart, JSON.stringify(res));
		return localpart;
	}

	// The mapped localparts get stored in the Username mapper, this
	// function attempts to lookup a username from the cache
	private static async lookupUsernameFromHmacSha256(localpart: string): Promise<IUsernameMapperResult | null> {
		try {
			const res = await UsernameMapper.levelup.get(localpart);
			try {
				return JSON.parse(res.toString()) as IUsernameMapperResult;
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

	private static setupLevelup() {
		UsernameMapper.levelup = LevelUP(LevelDOWN(UsernameMapper.config.folder));
	}
}
