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

export interface IUsernameMapperResult {
	username: string;
	persistentId?: string;
}

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
		const res = {
			username,
		} as IUsernameMapperResult;
		if (persistentId) {
			res.persistentId = persistentId;
		}
		await UsernameMapper.levelup.put(localpart, JSON.stringify(res));
		return localpart;
	}

	public static async localpartToUsername(localpart: string): Promise<IUsernameMapperResult | null> {
		log.verbose(`Converting localpart ${localpart} to username...`);
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
		return null;
	}

	private static config: UsernameMapperConfig;
	private static levelup: LevelUp;

	private static setupLevelup() {
		UsernameMapper.levelup = promisifyAll(levelup(rocksdb(UsernameMapper.config.folder)));
	}
}
