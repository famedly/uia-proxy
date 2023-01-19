import * as yaml from "js-yaml";
import * as fs from "node:fs";

import { Config, SingleUiaConfig, StageConfig } from "./config"
import { Log } from "./log"
import { UsernameMapper } from "./usernamemapper"

const log = new Log("readConfig")

export function readConfig(path: string): Config {
	const config = new Config();
	let origConfig: any; // tslint:disable-line no-any
	try {
		origConfig = yaml.load(fs.readFileSync(path, "utf8"));
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
