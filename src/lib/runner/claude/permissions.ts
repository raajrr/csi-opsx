import { mkdirSync, writeFileSync} from 'fs';
import { join } from 'path';
/*
 Convert an absolute filesystem path into the glob form Claude Code's permission
 engine matches against. Detection is by path SHAPE (drive letter), not process.platform,
 so this stays a pure string function that is unit-testable for both OSes from any machine.
    Windows: C:\Users\me\proj  -> //c/Users/me/proj   (MSYS: '//' + lowercase drive segment, no colon)
    POSIX:   /Users/me/proj    -> //Users/me/proj      (absolute path with one extra leading '/')
*/
export function toPermissionGlob(absolutePath: string): string {
    const drive = absolutePath.match(/^([A-Za-z]):[\\/](.*)$/);
    if(drive) {
        const letter = drive[1].toLowerCase();
        const rest = drive[2].replace(/\\/g, '/');
        return `//${letter}/${rest}`;
    }
    const posix = absolutePath.replace(/\\/g, '/');
    return posix.startsWith('/') ? `/${posix}` : `//${posix}`;
}

/*
 Write the per-workspace sandbox config. The workspace (cwd) is writable under
 --permission-mode acceptEdits; the runner re-grants READ access to the project with the
 --add-dir CLI flag (NOT additionalDirectories here — Claude Code ignores that
 permission-expanding entry in directories that were never trusted, and disposable
 workspaces never are). This file carries only the deny rules that claw back WRITE/EDIT
 on the project subtree; deny rules still load untrusted because they only shrink
 permissions, and deny overrides both allow and the acceptEdits mode.
*/
export function writePermissions(workspaceDir:  string, projectRoot: string): void {
    const settingsDir = join(workspaceDir, '.claude');
    mkdirSync(settingsDir, { recursive: true });

    const glob = toPermissionGlob(projectRoot);
    const settings = {
        permissions: {
            deny: [`Write(${glob}/**)`, `Edit(${glob}/**)`],
        },
    };
    writeFileSync(join(settingsDir, 'settings.json'), JSON.stringify(settings, null, 2));
}