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

import * as commandLineArgs from "command-line-args";
import * as commandLineUsage from "command-line-usage";
import { Session } from "./session";
import { Webserver } from "./webserver";
import { Config, SingleUiaConfig, StageConfig } from "./config";
import { UsernameMapper } from "./usernamemapper";
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

function readConfig(): Config {
	const config = new Config();
	let origConfig: any; // tslint:disable-line no-any
	try {
		origConfig = yaml.safeLoad(fs.readFileSync(options.config, "utf8"));
		config.applyConfig(origConfig);
		Log.Configure(config.logging);
		UsernameMapper.Configure(config.usernameMapper);
	} catch (err) {
		log.error("Failed to read the config file", err);
		process.exit(-1);
	}
	// now we need to iteratate over the config and fix up stuffs
	for (const type in config.uia) {
		if (config.uia.hasOwnProperty(type) && config.uia[type]) {
			if (!origConfig.uia[type]) {
				config.uia[type] = null;
				continue;
			}
			// first apply the templates)
			for (const template in config.templates) {
				if (config.templates.hasOwnProperty(template) && config.uia[type].hasOwnProperty(template)) {
					config.uia[type] = Object.assign(
						new SingleUiaConfig(),
						config.templates[template],
						config.uia[type][template] || {},
					);
				}
			}
			// next apply the stage templates
			for (const stage in config.uia[type].stages) {
				if (config.uia[type].stages.hasOwnProperty(stage)) {
					config.uia[type].stages[stage] = Object.assign(
						config.uia[type].stages[stage] || {},
						{ homeserver: config.homeserver },
					);
					if (config.stages[stage]) {
						config.uia[type].stages[stage] = Object.assign(
							new StageConfig(),
							config.stages[stage].config,
							config.uia[type].stages[stage] || {},
						);
						config.uia[type].stages[config.stages[stage].type] = config.uia[type].stages[stage];
						delete config.uia[type].stages[stage];
					}
				}
			}
		}
	}
	return config;
}

async function run() {
	const config = readConfig();
	const session = new Session(config.session);

	const api = new Api(config.homeserver);
	const webserver = new Webserver(config.webserver, config.homeserver, config.uia, session, api);
	await webserver.start();
}
run(); // tslint:disable-line no-floating-promises
