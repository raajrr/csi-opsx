export interface RunnerResult {
    exitCode: number;
    stdout: string;
    stderr: string;
}

export interface Runner {
    isAvailable(): boolean;
    run(prompt: string, workspaceDir: string): Promise<RunnerResult>;
}