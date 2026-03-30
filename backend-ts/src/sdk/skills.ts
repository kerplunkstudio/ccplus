import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { execFileSync } from "child_process";
import { homedir } from "os";
import path from "path";
import type { SkillInfo } from "./types.js";
import { findClaudeBinary } from "../utils.js";
import { log } from "../logger.js";

let cachedSkills: SkillInfo[] | null = null;

function parseDescription(filePath: string): string | null {
  try {
    const content = readFileSync(filePath, "utf-8");
    const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
    if (match) {
      const descMatch = match[1].match(/description:\s*(.+)/);
      if (descMatch) return descMatch[1].trim();
    }
  } catch (err) {
    log.error('Failed to parse description from skill file', { filePath, error: String(err) });
  }
  return null;
}

export function discoverSkills(projectPath?: string): SkillInfo[] {
  if (cachedSkills && !projectPath) return cachedSkills;

  const skills: SkillInfo[] = [];
  const claudeDir = path.join(homedir(), ".claude");

  // 1. User commands
  const userCmdDir = path.join(claudeDir, "commands");
  if (existsSync(userCmdDir)) {
    try {
      for (const file of readdirSync(userCmdDir)) {
        if (!file.endsWith(".md")) continue;
        const name = file.replace(/\.md$/, "");
        const desc = parseDescription(path.join(userCmdDir, file));
        skills.push({ name, plugin: "user", description: desc || "" });
      }
    } catch (err) {
      log.error('Failed to discover user commands', { error: String(err) });
    }
  }

  // 2. User skills
  const userSkillsDir = path.join(claudeDir, "skills");
  if (existsSync(userSkillsDir)) {
    try {
      for (const dir of readdirSync(userSkillsDir)) {
        const skillFile = path.join(userSkillsDir, dir, "SKILL.md");
        if (!existsSync(skillFile)) continue;
        const desc = parseDescription(skillFile);
        skills.push({ name: dir, plugin: "skill", description: desc || "" });
      }
    } catch (err) {
      log.error('Failed to discover user skills', { error: String(err) });
    }
  }

  // 3. Plugin skills via Claude CLI
  try {
    const claudeBin = findClaudeBinary();
    if (claudeBin) {
      const output = execFileSync(claudeBin, ["plugin", "list", "--json"], {
        timeout: 30000, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"],
      });
      const plugins = JSON.parse(output.trim());
      if (Array.isArray(plugins)) {
        for (const plugin of plugins) {
          const pluginName = plugin.name || (plugin.id || "").split("@")[0];
          const installPath = plugin.installPath || "";
          if (installPath) {
            const skillsPath = path.join(installPath, ".claude", "skills");
            if (existsSync(skillsPath)) {
              try {
                for (const dir of readdirSync(skillsPath)) {
                  if (!statSync(path.join(skillsPath, dir)).isDirectory()) continue;
                  if (skills.some(s => s.name === dir)) continue;
                  const skillFile = path.join(skillsPath, dir, "SKILL.md");
                  const desc = existsSync(skillFile) ? parseDescription(skillFile) : null;
                  skills.push({ name: dir, plugin: pluginName, description: desc || "" });
                }
              } catch (err) {
                log.error('Failed to discover skills from plugin', { pluginName, error: String(err) });
              }
            }
            const cmdDir = path.join(installPath, "commands");
            if (existsSync(cmdDir)) {
              try {
                for (const file of readdirSync(cmdDir)) {
                  if (!file.endsWith(".md")) continue;
                  const name = file.replace(/\.md$/, "");
                  if (skills.some(s => s.name === name)) continue;
                  const desc = parseDescription(path.join(cmdDir, file));
                  skills.push({ name, plugin: pluginName, description: desc || "" });
                }
              } catch (err) {
                log.error('Failed to discover commands from plugin', { pluginName, error: String(err) });
              }
            }
          }
          if (Array.isArray(plugin.skills)) {
            for (const skillName of plugin.skills) {
              if (skills.some(s => s.name === skillName)) continue;
              skills.push({ name: skillName, plugin: pluginName, description: "" });
            }
          }
        }
      }
    }
  } catch (err) {
    log.error('Failed to discover plugin skills via Claude CLI', { error: String(err) });
  }

  // 4. Project-level commands
  if (projectPath) {
    const projCmdDir = path.join(projectPath, ".claude", "commands");
    if (existsSync(projCmdDir)) {
      try {
        for (const file of readdirSync(projCmdDir)) {
          if (!file.endsWith(".md")) continue;
          const name = file.replace(/\.md$/, "");
          if (skills.some(s => s.name === name)) continue;
          const desc = parseDescription(path.join(projCmdDir, file));
          skills.push({ name, plugin: "project", description: desc || "" });
        }
      } catch (err) {
        log.error('Failed to discover project commands', { error: String(err) });
      }
    }
  }

  // 5. Project-level skills
  if (projectPath) {
    const projSkillsDir = path.join(projectPath, ".claude", "skills");
    if (existsSync(projSkillsDir)) {
      try {
        for (const dir of readdirSync(projSkillsDir)) {
          const dirPath = path.join(projSkillsDir, dir);
          if (!statSync(dirPath).isDirectory()) continue;
          if (skills.some(s => s.name === dir)) continue;
          const skillFile = path.join(dirPath, "SKILL.md");
          const desc = existsSync(skillFile) ? parseDescription(skillFile) : null;
          skills.push({ name: dir, plugin: "project", description: desc || "" });
        }
      } catch (err) {
        log.error('Failed to discover project skills', { error: String(err) });
      }
    }
  }

  if (!projectPath) cachedSkills = skills;
  return skills;
}

// Discover installed plugin paths for the SDK plugins option
let cachedPluginPaths: Array<{ type: "local"; path: string }> | null = null;

export function getInstalledPlugins(): Array<{ type: "local"; path: string }> {
  if (cachedPluginPaths) return cachedPluginPaths;

  const result: Array<{ type: "local"; path: string }> = [];
  try {
    const claudeBin = findClaudeBinary();
    if (claudeBin) {
      const output = execFileSync(claudeBin, ["plugin", "list", "--json"], {
        timeout: 30000, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"],
      });
      const plugins = JSON.parse(output.trim());
      if (Array.isArray(plugins)) {
        for (const plugin of plugins) {
          const installPath = plugin.installPath || "";
          if (installPath && existsSync(installPath)) {
            result.push({ type: "local", path: installPath });
          }
        }
      }
    }
  } catch (err) {
    log.error('Failed to get installed plugins via Claude CLI', { error: String(err) });
  }

  cachedPluginPaths = result;
  return result;
}
