#!/usr/bin/env node
import { main } from '../src/main.mjs';

process.exitCode = await main(process.argv.slice(2), { stdout: process.stdout, stderr: process.stderr, stdin: process.stdin, env: process.env });
