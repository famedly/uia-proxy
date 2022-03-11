import { expect } from "chai";
import { once } from "events";
import express from "express";
import * as jwt from "jsonwebtoken";
import { AddressInfo } from "net";
import { Log } from "../../src/log";
import { Stage } from "../../src/stages/stage_com.famedly.login.crm";

// we are a test file and thus our linting rules are slightly different
// tslint:disable:no-unused-expression max-file-line-count no-any no-string-literal

describe("Stage com.famedly.login.crm", () => {
	it("should work with a valid signature", async () => {
		const secret = "SuperDuperSecret";
		// tslint:disable-next-line variable-name
		const pharmacy_id = "foobar-medicine";
		const sub = "user-person";
		const name = "User McPerson";

		// Set up the server
		const http = express();
		http.get("/jwt-key", (_, res) => {
			res.send(secret);
		});
		http.get("/jwt-algorithm", (_, res) => {
			res.send('HS256');
		});
		const server = http.listen(0);
		await once(server, "listening");
		// Cast since we're not connecting to a unix socket
		const port = (server.address() as AddressInfo).port;

		// Set up the stage
		const stage = new Stage();
		await stage.init({
			url: `http://localhost:${port}/`,
			pharmacy_id,
			homeserver: { domain: 'test.example' } as any,
		}, undefined);

		const token = jwt.sign({
			sub,
			name,
			pharmacy_id,
		}, secret);

		const response = await stage.auth({ token }, null);
		server.close();
		expect(response.error).to.be.undefined;
		expect(response.errcode).to.be.undefined;
		expect(response.success).to.be.true;
		expect(response.data).to.not.be.undefined;
		expect(response.data!.username).to.equal(sub);
		expect(response.data!.displayname).to.equal(name);
	});
});
