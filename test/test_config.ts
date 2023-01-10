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

import { expect } from "chai";
import { Config } from "../src/config";
import * as yaml from "js-yaml";
import * as fs from "fs";

// test related linting leniency
// tslint:disable:no-unused-expression

describe("Configuration", () => {
	it("should deserialize the sample correctly", () => {
		const configInput = yaml.load(fs.readFileSync("config.sample.yaml", "utf8"));
		expect(() => Config.from(configInput)).to.not.throw;
	})
})
