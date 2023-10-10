/*
Copyright 2018 matrix-appservice-discord

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

	http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import { argv } from "process";
import { Log } from "../src/log";
import WhyRunning from "why-is-node-running";
import { LoggingConfig } from "../src/config";

const noisyFlag = '--noisy';
const allowedLevels = ['silly','input','verbose','http','prompt','debug','info','data','help','warn','error'];
const noWhyRunningFlag = '--noWhyRunning'

// Configure logging level for the test run
if ( !argv.includes(noisyFlag) ) {
	// Silence the log, if no --noisy flag
	Log.ForceSilent();
} else {
	// Otherwise check if custom level provided or use 'debug' by default
	const customVal = argv[argv.indexOf(noisyFlag) + 1]; // We are not checking for index out of bounds, since 'undefined' is not a valid level!
	const isProvided = allowedLevels.includes(customVal);
	const levelToUse = isProvided ? customVal : 'debug';

	// Construct simple logging config
	const loggingCfg = {
		console: levelToUse,
		lineDateFormat: "MMM-D HH:mm:ss.SSS",
		files: []
	} as LoggingConfig;

	// Configure the logger
	new Log("Log").warn(`Setting log level to: ${levelToUse} (${ isProvided ? 'provided' : 'default' }). See ./test/config.ts for further details.`);
	Log.Configure(loggingCfg);
}

after(() => {
	if(!argv.includes(noWhyRunningFlag)){
		WhyRunning();
	}
});
