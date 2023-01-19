/*
Copyright (C) 2020, 2021 Famedly

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

import commandLineArgs from "command-line-args";
import commandLineUsage from "command-line-usage";
import { Session } from "./session";
import { Webserver } from "./webserver";
import { Config } from "./config";
import { UsernameMapper } from "./usernamemapper";
import { Api } from "./api";
import { Log } from "./log";
import * as yaml from "js-yaml";
import * as fs from "fs";
import { repairDb } from "../utils/repair";

const log = new Log("index");

const commandOptions = [
	{ name: "config", alias: "c", type: String },
	{ name: "help", alias: "h", type: Boolean },
];

const options = Object.assign({
	config: "config.yaml",
	help: false,
}, commandLineArgs(commandOptions));

if (options.help) {
	// tslint:disable-next-line:no-console
	console.log(commandLineUsage([
		{
			header: "famedly-login-service",
			content: "A service that handles login for matrix servers",
		},
		{
			header: "Options",
			optionList: commandOptions,
		},
	]));
	process.exit(0);
}

export function readConfig(path: string): Config {
	try {
		const configInput = yaml.load(fs.readFileSync(path, "utf8"));
		const config = Config.from(configInput);
		Log.Configure(config.logging);
		UsernameMapper.Configure(config.usernameMapper);
		return config;
	} catch (err) {
		log.error("Failed to read the config file", err);
		process.exit(-1);
	}
}

async function run() {
	const config = readConfig(options.config);
	if (config.maintenance.repairDb) {
		await repairDb(config);
	}
	const session = new Session(config.session);

	const api = new Api(config.homeserver);
	const webserver = new Webserver(config.webserver, config.homeserver, config.uia, session, api);
	await webserver.start();
}
run(); // tslint:disable-line no-floating-promises
