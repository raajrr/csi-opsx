export interface RunnerResult {
    exitCode: number;
    stdout: string;
    stderr: string;
}

export interface RunnerOptions {
    prompt: string;
    workspaceDir: string;
    writablePaths?: string[];
}

export interface Runner {
    isAvailable(): boolean;
    run(opts: RunnerOptions): Promise<RunnerResult>;
}