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

import * as commandLineArgs from "command-line-args";
import * as commandLineUsage from "command-line-usage";
import { Session } from "./session";
import { StageHandler } from "./stagehandler";
import { Config } from "./config";
import { Api } from "./api";
import { Log } from "./log";
import * as yaml from "js-yaml";
import * as fs from "fs";

const log = new Log("index");

const commandOptions = [
	{ name: "config", alias: "c", type: String },
	{ name: "help", alias: "h", type: Boolean },
];

const options = Object.assign({
	config: "config.yaml",
	help: false,
});

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

function readConfig(): Config {
	const config = new Config();
	try {
		config.applyConfig(yaml.safeLoad(fs.readFileSync(options.config, "utf8")));
		Log.Configure(config.logging);
	} catch (err) {
		log.error("Failed to read the config file", err);
		process.exit(-1);
	}
	return config;
}

async function run() {
	const config = readConfig();
	const session = new Session(config.session);
	const stageHandler = new StageHandler(config.stages, config.flows);
	await stageHandler.load();

	const api = new Api(session, stageHandler);

	const sess = session.new("login");
	const reply = await api.getBaseReply({session: sess} as any);
	console.log(reply);
}
run();
