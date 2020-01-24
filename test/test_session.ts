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

import { expect } from "chai";
import { Session } from "../src/session";

// we are a test file and thus our linting rules are slightly different
// tslint:disable:no-unused-expression max-file-line-count no-any no-magic-numbers

async function delay(ms) {
	return new Promise((resolve, reject) => {
		setTimeout(resolve, ms);
	});
}

describe("Session", () => {
	describe("new", () => {
		it("should generate a new session", () => {
			const session = new Session({ timeout: 120 });
			const sess = session.new("/login");
			expect(sess.endpoint).to.equal("/login");
			expect(sess.params).eql({});
			expect(sess.data).eql({});
			expect(sess.save).to.exist;
		});
		it("should make sure, that the newly generated entry is retrivable", () => {
			const session = new Session({ timeout: 120 });
			const sess = session.new("/login");
			const sessGet = session.get(sess.id);
			expect(sess).eql(sessGet);
		});
	});
	describe("get", () => {
		it("should return null, should the entry not exist", () => {
			const session = new Session({ timeout: 120 });
			const sess = session.get("invalid");
			expect(sess).to.be.null;
		});
		it("should return null, should the entry expire", async () => {
			const session = new Session({ timeout: 50 });
			const sess = session.new("/login");
			await delay(60);
			const sessGet = session.get(sess.id);
			expect(sessGet).to.be.null;
		});
		it("should return a valid session, if all is fine", () => {
			const session = new Session({ timeout: 120 });
			const sess = session.new("/login");
			const sessGet = session.get(sess.id);
			expect(sess).eql(sessGet);
		});
	});
	describe("set", () => {
		it("should not set a session, should it not already exist", () => {
			const session = new Session({ timeout: 120 });
			const ret = session.set({ id: "invalid" } as any);
			expect(ret).to.be.false;
		});
		it("should set a session, should it already exist", () => {
			const session = new Session({ timeout: 120 });
			const sess = session.new("/login");
			const ret = session.set(sess);
			expect(ret).to.be.true;
		});
	});
});
