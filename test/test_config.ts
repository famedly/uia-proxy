/*
Copyright (C) 2022 Famedly

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

import chai, { expect } from "chai";
import { Config } from "../src/config";
import * as yaml from "js-yaml";
import * as fs from "fs";
import { Log } from "../src/log";

const log = new Log("test_config");

// configure more meaningfull output
chai.config.includeStack = true;
chai.config.truncateThreshold = 0;

describe("Configuration", () => {
	it("should deserialize config.sample.yaml file correctly", () => {
		const configInput = yaml.load(fs.readFileSync("config.sample.yaml", "utf8"));
		expect(() => Config.from(configInput)).to.not.throw();
	})
	it("should support uia.*.stageAliases", () => {
		// See: https://github.com/famedly/uia-proxy/issues/205
		// NOTE: this test relies on the content of 'config.sample.yaml' file,
		// expecting the 'uia.login.stageAliases' to be configured there as following:
		const expectedStageAliases: Record<string, string> = {
			"m.login.password": "com.famedly.login.sso",
			"m.login.dummy": "m.login.dummy"
		};

		const configInput = yaml.load(fs.readFileSync("config.sample.yaml", "utf8"));
		let stageAliasesFromConfig: Record<string, string> = {};
		expect(() => {
			// NOTE: it schould be enough to test only one entry (i.e. uia.login.stageAliases),
			// because it is a generic functionality of SingleUiaConfig, which is inherited by all of
			// 'deleteDevice', 'deleteDevices', 'login', 'password' and 'uploadDeviceSigningKeys'.
			stageAliasesFromConfig = Config.from(configInput).uia.login.stageAliases;
			// eslint-disable-next-line  no-magic-numbers
			log.verbose(`Got uia.login.stageAliases from config.sample.yaml as:\n${JSON.stringify(stageAliasesFromConfig, null, 2)} `);
		}).to.not.throw();
		expect(stageAliasesFromConfig).eqls(expectedStageAliases);
	})
})
