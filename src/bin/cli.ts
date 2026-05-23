#!/usr/bin/env node // Unix shebang - tells the OS to run the file with Node when executed from the terminal
import { Command } from "commander";
import { spawnSync } from 'child_process';
import { join, dirname} from 'path';
import { fileURLToPath} from 'url';
import pkg from '../../package.json' with { type: 'json'};
import {COMMAND_NAMES, CommandName} from "../lib/types.js";
import {getConfiguredTools} from "../lib/tool-detection.js";
import {TOOL_DIRS} from "../lib/tools.js";
import {installCommands, installSkills, installThirdPartySkills} from "../lib/install.js";

// The double underscore prefix to dirname is a coding convention borrowed from CommonJS
const __dirname = dirname(fileURLToPath(import.meta.url));
const COMMANDS_DIR = join(__dirname, '..', 'commands');
const SKILLS_DIR = join(__dirname, '..', 'skills');

const program = new Command();
program
    .name('csi-opsx')
    .description('OpenSpec wrapper with automated review loops')
    .version(pkg.version);

program
    .command('init')
    .description('Run openspec init and install csi-opsx skills')
    .action(() => {
        const result = spawnSync('openspec',
            ['init'],
            { stdio: 'inherit', shell: true });
        if (result.status !== 0) { process.exit(result.status ?? 1); }
        installCsiOpsx();
    });

program.command('update')
    .description('Run openspec update and reinstall csi-opsx skills')
    .action(() => {
        const result = spawnSync('openspec',
            ['update'],
            { stdio: 'inherit', shell: true });
        if (result.status !== 0) { process.exit(result.status ?? 1); }
        installCsiOpsx();
    });

// Async function that takes { workspace, artifacts } and returns nothing.
// HarnessRunner is the type alias (similar to defining a Java functional interface)
type HarnessRunner = (opts: { workspace: string; artifacts: string[] }) => Promise<void>;
// Partial<Record...> because we only want entries for commands (CommandNames) for
// which this needs to be called.
const HARNESS_RUNNERS: Partial<Record<CommandName, HarnessRunner>> = {
    propose: async (opts) => {
        const { runProposeHarness } = await import('../commands/propose/harness.js');
        await runProposeHarness(opts);
    }
};

program
    .command('run')
    .description('Internal: run a harnessed command (called by skills via Bash)')
    .requiredOption('--command <name>', 'command to run (propose)')
    .requiredOption('--workspace <path>', 'project workspace path')
    .requiredOption('--artifacts <csv>', 'comma-separated artifact relative paths')
    .action(async (opts) => {
        const runner = HARNESS_RUNNERS[opts.command as CommandName];
        if (!runner) {
            console.error(`Unknown commandL ${opts.command}`);
            process.exit(1);
        }
        await runner({
            workspace: opts.workspace,
            artifacts: (opts.artifacts as string).split(',').map((a) => a.trim()),
        });
    });

// Tells commander to read the actual command line arguments and execute the matching command (defined above)
program.parse();

function installCsiOpsx(): void {
    const tools = getConfiguredTools(process.cwd());
    if (tools.length === 0) {
        console.log('No OpenSpec-configured agents detected. Please run openspec init first.');
        return;
    }
    for (const toolId of tools) {
        const toolDir = TOOL_DIRS[toolId];
        installSkills(process.cwd(), toolDir, COMMAND_NAMES, COMMANDS_DIR);
        installCommands(process.cwd(), toolId, toolDir, COMMAND_NAMES, COMMANDS_DIR);
        installThirdPartySkills(process.cwd(), toolDir, SKILLS_DIR);
        console.log(`✓ Installed csi-opsx skills for ${toolId} (${toolDir})`);
    }
}