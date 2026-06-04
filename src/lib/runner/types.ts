export interface RunnerResult {
    exitCode: number;
    stdout: string;
    stderr: string;
}

export interface RunnerOptions {
    prompt: string;
    workspaceDir: string;   // the temp agent cwd (the only writable area)
    projectRoot?: string;   // the real project dir; when set, the runner sandboxes the project read-only
}

export interface Runner {
    isAvailable(): boolean;
    run(opts: RunnerOptions): Promise<RunnerResult>;
}