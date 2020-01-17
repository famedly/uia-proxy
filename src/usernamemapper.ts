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

import { UsernameMapperConfig } from "./config";
import { Log } from "./log";
import * as crypto from "crypto";
import * as base32 from "base32";
import * as promisifyAll from "util-promisifyall";
import levelup, { LevelUp } from "levelup";
import rocksdb from "rocksdb";

const log = new Log("UsernameMapper");

export class UsernameMapper {
	public static Configure(config: UsernameMapperConfig) {
		UsernameMapper.config = Object.assign(new UsernameMapperConfig(), config);
		UsernameMapper.setupLevelup();
	}

	public static async usernameToLocalpart(username: string, persistentId?: string): Promise<string> {
		log.verbose(`Converting username ${username} with persistentId ${persistentId} to localpart...`);
		const localpart = base32.encode(
			crypto.createHmac("SHA256", UsernameMapper.config.pepper)
				.update(persistentId || username).digest(),
		).toLowerCase();
		await UsernameMapper.levelup.put(localpart, username);
		return localpart;
	}

	public static async localpartToUsername(localpart: string): Promise<string | null> {
		log.verbose(`Converting localpart ${localpart} to username...`);
		try {
			const username = await UsernameMapper.levelup.get(localpart);
			if (username) {
				return username.toString();
			}
		} catch (err) {
			if (err.notFound) {
				return null;
			}
			throw err;
		}
		return null;
	}

	private static config: UsernameMapperConfig;
	private static levelup: LevelUp;

	private static setupLevelup() {
		UsernameMapper.levelup = promisifyAll(levelup(rocksdb(UsernameMapper.config.folder)));
	}
}
