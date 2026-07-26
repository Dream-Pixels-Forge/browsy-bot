#!/usr/bin/env node

/**
 * Browsy CLI - Command-line interface for CDP operations
 * Usage: browsy <command> [options]
 *
 * Commands:
 *   navigate <url>           Navigate to URL
 *   screenshot [options]     Capture screenshot
 *   eval <expression>        Evaluate JavaScript in page context
 *   open <url>               Open URL in browser (bring to front)
 */

import { Command } from 'commander';
import { navigate, captureScreenshot, evaluate } from './index.js';
import * as fs from 'fs';

const program = new Command();

program
  .name('browsy')
  .description('Raw CDP browser automation for OpenCode')
  .version('0.1.0')
  .option('-u, --url <url>', 'Chrome DevTools WebSocket URL', 'ws://localhost:9222')
  .option('-t, --target <id>', 'Target ID (tab/window)', '');

program
  .command('navigate <url>')
  .description('Navigate to a URL')
  .action(async (url: string, options: any) => {
    try {
      await navigate(options.url || program.opts().url, url, options.target);
      console.log(`[browsy] Navigated to ${url}`);
    } catch (error: any) {
      console.error('[browsy] Navigation failed:', error.message);
      process.exit(1);
    }
  });

program
  .command('screenshot')
  .description('Capture a screenshot (PNG base64 output)')
  .option('-o, --output <file>', 'Output file (if not specified, prints to stdout)')
  .action(async (options: any) => {
    try {
      const data = await captureScreenshot(
        options.url || program.opts().url,
        { format: 'png' },
        options.target || program.opts().target
      );

      if (options.output) {
        fs.writeFileSync(options.output, Buffer.from(data, 'base64'));
        console.log(`[browsy] Screenshot saved to ${options.output}`);
      } else {
        console.log(data);
      }
    } catch (error: any) {
      console.error('[browsy] Screenshot failed:', error.message);
      process.exit(1);
    }
  });

program
  .command('eval <expression>')
  .description('Evaluate JavaScript expression in page context')
  .action(async (expression: string, options: any) => {
    try {
      const result = await evaluate(
        options.url || program.opts().url,
        expression,
        options.target || program.opts().target
      );
      console.log(JSON.stringify(result, null, 2));
    } catch (error: any) {
      console.error('[browsy] Evaluation failed:', error.message);
      process.exit(1);
    }
  });

program
  .command('open <url>')
  .description('Open URL and bring browser to front')
  .action(async (url: string, options: any) => {
    try {
      await navigate(options.url || program.opts().url, url, options.target);
      console.log(`[browsy] Opened ${url}`);
    } catch (error: any) {
      console.error('[browsy] Open failed:', error.message);
      process.exit(1);
    }
  });

program.parse();