import { mkdirSync, writeFileSync} from 'fs';
import { join } from 'path';

export function writePermissions(workspaceDir: string, writableRelativePaths: string[]): void {
    const settingsDir = join(workspaceDir, '.claude');
    mkdirSync(settingsDir, { recursive: true });

    const settings = {
        permissions: {
            allow: writableRelativePaths.map(f => `Write(${f})`),
            deny: ['Write(*)'],
        },
    };

    writeFileSync(join(settingsDir, 'settings.json'), JSON.stringify(settings, null, 2));
}