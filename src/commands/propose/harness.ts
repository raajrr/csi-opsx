export interface HarnessOptions {
    workspace: string;
    artifacts: string[];
}

export async function runProposeHarness(_opts: HarnessOptions): Promise<void> {
    console.log('⚠ Propose harness not yet implemented. Use /opsx:propose directly.');
}