import { Session } from "./session";
import { StageHandler } from "./stagehandler";

const session = new Session();
const stageHandler = new StageHandler();

async function run() {
	await stageHandler.load();
	
	const sess = session.new();
	let reply = await stageHandler.getParams(sess);
	console.log(reply);
	reply = await stageHandler.getParams(sess);
	console.log(reply);
}
run();
