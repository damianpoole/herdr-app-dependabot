import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex, Input, InputState } from "gpui-base";
import {
  theme,
  exec,
  props,
  run,
  layout,
  spaces,
  panes,
  updates,
  nextCommand,
  notify,
} from "herdr";
import config from "./config.js";
import { call, fetchRows, openTab } from "./client.js";
import {
  severities,
  mergeResult,
  visibleRows,
  visibleAlerts,
  total,
  age,
  findBlock,
} from "./model.js";

export default class Dependabot extends View {
  init(_props, cx) {
    this.config = { ...config, ...props() };
    this.rows = [];
    this.warnings = [];
    this.error = "";
    this.loading = false;
    this.loaded = false;
    this.query = "";
    this.severity = "all";
    this.onlyIssues = false;
    this.selected = "";
    this.alertNumber = null;
    this.handle = cx.focus_handle();
    this.search = InputState.new({ placeholder: "Search repos, packages, CVEs…" });
    this.search.on("change", (_event, cx) => {
      this.query = this.search.value();
      cx.notify();
    });
    cx.spawn(async (cx) => {
      for (;;) {
        const command = await nextCommand();
        if (command === "focus") this.search.focus();
        if (command === "refresh" && !["footer", "strip"].includes(this.config.role))
          this.refresh(cx);
        if (command === "open") this.openPanel();
        if (command === "issues") {
          this.onlyIssues = !this.onlyIssues;
          cx.notify();
        }
        if (command === "next-repo") {
          const index = this.rows.findIndex((r) => r.repository === this.selected);
          this.selected = this.rows[(index + 1) % this.rows.length]?.repository ?? "";
          this.alertNumber = null;
          cx.notify();
        }
        if (command === "next-alert") {
          const row = this.rows.find((r) => r.repository === this.selected);
          const alerts = row ? visibleAlerts(row, this.query, this.severity) : [];
          const index = alerts.findIndex((a) => a.number === this.alertNumber);
          this.alertNumber = alerts[(index + 1) % alerts.length]?.number ?? null;
          cx.notify();
        }
      }
    });
    if (!["footer", "strip"].includes(this.config.role)) {
      cx.timer.every(60000, (cx) => cx.notify());
      this.refresh(cx);
    }
  }

  refresh(cx) {
    if (this.loading) return;
    this.loading = true;
    this.error = "";
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const args = ["discover", ...(this.config.roots ?? []).flatMap((root) => ["--root", root])];
        const discovery = await call(exec, this.config, args);
        this.warnings = discovery.warnings ?? [];
        const previous = new Map(this.rows.map((row) => [row.repository, row]));
        this.rows = discovery.repositories.map((repo) => ({
          ...previous.get(repo.repository),
          ...repo,
          status: "loading",
          stale: !!previous.get(repo.repository)?.counts,
        }));
        cx.notify();
        await fetchRows(
          this.rows,
          (repo) => call(exec, this.config, ["alerts", repo]),
          (row, result) => {
            const index = this.rows.findIndex((r) => r.repository === row.repository);
            this.rows[index] = { ...row, ...mergeResult(previous.get(row.repository), result) };
            cx.notify();
          },
        );
        this.loaded = true;
      } catch (error) {
        this.error = String(error.message ?? error);
        this.rows = this.rows.map((row) => ({ ...row, stale: true }));
      } finally {
        this.loading = false;
        cx.notify();
      }
    });
  }

  openPanel() {
    if (
      !openTab({
        spaces: spaces(),
        panes: panes(),
        run,
        mod: "dependabot",
        name: "Dependabot",
        props: { ...this.config, role: "dashboard" },
      })
    )
      notify({ title: "Dependabot", body: "Open a local space first.", level: "info" });
  }

  footer(t) {
    const collapsed = (findBlock(layout(), "sidebar")?.size?.px ?? Infinity) < 160;
    const row = (id, icon, label, action, dim = false) =>
      h_flex()
        .id(id)
        .h(28)
        .px(8)
        .gap(9)
        .items_center()
        .rounded(8)
        .text_color(dim ? t.dim : t.muted)
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .cursor_pointer()
        .on_click(action)
        .child(icon)
        .when(!collapsed, (el) => el.child(label));
    return v_flex()
      .id("dependabot-footer")
      .size_full()
      .bg(t.chrome)
      .border_t(1)
      .border_color(t.border)
      .px(8)
      .pt(4)
      .pb(8)
      .text_size(13)
      .child(
        row("settings", svg("mods/workspace-chrome/settings.svg").size(14), "Settings", () =>
          run("app.settings"),
        ).when(Boolean(updates().app.ready), (el) =>
          el.child(div().size(6).rounded_full().bg(t.accent)),
        ),
      )
      .child(row("dependabot-open", div().w(14).child("◇"), "Dependabot", () => this.openPanel()))
      .when(this.config.tasks === true, (el) =>
        el.child(
          row(
            "obsidian-tasks",
            svg("mods/obsidian-tasks-footer/tasks.svg").size(14),
            "Tasks",
            () => {
              if (
                !openTab({
                  spaces: spaces(),
                  panes: panes(),
                  run,
                  mod: "obsidian-tasks",
                  name: "Obsidian Tasks",
                })
              )
                run("mod.open", { name: "obsidian-tasks" });
            },
          ),
        ),
      )
      .child(
        row(
          "machine",
          svg("mods/workspace-chrome/plus.svg").size(14),
          "Add machine",
          () => run("mod.open", { name: "machine-add" }),
          true,
        ),
      );
  }

  button(id, label, action, t, active = false) {
    return h_flex()
      .id(id)
      .px(8)
      .h(27)
      .items_center()
      .rounded(5)
      .border_1()
      .border_color(active ? t.accent : t.border)
      .bg(active ? t.selected : t.chrome)
      .text_color(t.foreground)
      .text_size(11)
      .cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .on_click((_event, cx) => action(cx))
      .child(label);
  }

  link(id, label, url, t) {
    return this.button(id, label, (cx) => cx.open_url(url), t);
  }

  counts(row, t) {
    return h_flex()
      .gap(8)
      .flex_wrap()
      .children(
        severities
          .filter((s) => row.counts?.[s] > 0)
          .map((s) =>
            div()
              .text_size(11)
              .text_color(s === "critical" || s === "high" ? t.blocked : t.muted)
              .child(`${row.counts[s]} ${s}`),
          ),
      );
  }

  detail(alert, t) {
    const field = (label, value) =>
      div()
        .text_color(t.muted)
        .child(`${label}: ${value || "Not supplied"}`);
    return v_flex()
      .id("dependabot-detail")
      .p(12)
      .gap(7)
      .bg(t.raised)
      .child(
        div()
          .font_semibold()
          .child(alert.summary || "Security advisory"),
      )
      .child(
        div()
          .text_color(t.blocked)
          .child(`${alert.severity.toUpperCase()} · ${alert.ghsa} ${alert.cve}`),
      )
      .child(field("Package", `${alert.package} (${alert.ecosystem})`))
      .child(field("Manifest", alert.manifest))
      .child(field("Scope", alert.scope))
      .child(field("Vulnerable", alert.vulnerableRange))
      .child(field("First patched version", alert.patched || "No patch available"))
      .child(
        div()
          .text_size(11)
          .text_color(t.muted)
          .child(alert.description || "No advisory description."),
      )
      .child(this.link("alert-github", "Open alert on GitHub ↗", alert.url, t));
  }

  repositoryPanel(row, t) {
    const alerts = visibleAlerts(row, this.query, this.severity);
    const selected = alerts.find((a) => a.number === this.alertNumber);
    return v_flex()
      .gap(8)
      .p(12)
      .border_t_1()
      .border_color(t.border)
      .child(div().font_semibold().child(row.repository))
      .child(
        div()
          .text_size(11)
          .text_color(t.muted)
          .child(`${row.paths?.length ?? 0} local checkout(s) · ${age(row)}`),
      )
      .child(
        this.link(
          "repo-github",
          "Repository alerts ↗",
          `https://github.com/${row.repository}/security/dependabot`,
          t,
        ),
      )
      .when(!!row.error, (el) => el.child(div().text_color(t.blocked).child(row.error)))
      .when(!!row.stale, (el) =>
        el.child(div().text_color(t.blocked).child("Previous results — do not treat as current.")),
      )
      .children(
        alerts.map((a) =>
          v_flex()
            .id(`alert-${a.number}`)
            .p(9)
            .gap(4)
            .rounded(5)
            .bg(a.number === this.alertNumber ? t.selected : t.chrome)
            .cursor_pointer()
            .hover((s) => s.bg(t.hover))
            .on_click((_event, cx) => {
              this.alertNumber = a.number === this.alertNumber ? null : a.number;
              cx.notify();
            })
            .child(
              div()
                .text_size(11)
                .text_color(t.blocked)
                .child(`#${a.number} · ${a.severity} · ${a.ecosystem}`),
            )
            .child(div().font_semibold().child(a.package))
            .child(div().text_color(t.muted).child(a.summary)),
        ),
      )
      .when(!alerts.length, (el) =>
        el.child(
          div()
            .text_color(t.muted)
            .child(
              row.status === "loading"
                ? "Fetching alerts…"
                : row.status !== "ok"
                  ? "Current alerts unavailable."
                  : total(row) === 0
                    ? "No open security alerts."
                    : "No alerts match these filters.",
            ),
        ),
      )
      .when(!!selected, (el) => el.child(this.detail(selected, t)));
  }

  render() {
    const t = theme();
    if (this.config.role === "footer") return this.footer(t);
    if (this.config.role === "strip")
      return h_flex()
        .id("dependabot-launcher")
        .h_full()
        .px(8)
        .items_center()
        .bg(t.chrome)
        .child(
          this.button("dependabot-open", "Dependabot · Security alerts", () => this.openPanel(), t),
        );
    const rows = visibleRows(this.rows, this.query, this.severity, this.onlyIssues);
    const selected = rows.find((row) => row.repository === this.selected);
    const done = this.rows.filter((row) => row.status === "ok").length;
    const unavailable = this.rows.filter((row) => row.status === "unavailable").length;
    const known = this.rows
      .filter((row) => row.status === "ok")
      .reduce((sum, row) => sum + (total(row) ?? 0), 0);
    return v_flex()
      .id("dependabot-root")
      .track_focus(this.handle)
      .size_full()
      .min_h(0)
      .bg(t.surface)
      .text_color(t.foreground)
      .text_size(12)
      .child(
        h_flex()
          .px(12)
          .h(42)
          .gap(8)
          .items_center()
          .border_b_1()
          .border_color(t.border)
          .child(div().flex_1().font_semibold().child("Dependabot"))
          .child(
            this.button(
              "dependabot-refresh",
              this.loading ? "Refreshing…" : "Refresh",
              (cx) => this.refresh(cx),
              t,
            ),
          ),
      )
      .child(
        v_flex()
          .p(12)
          .gap(7)
          .child(div().text_color(t.muted).text_size(11).child("LOCAL REPOSITORIES · READ ONLY"))
          .child(
            div()
              .font_semibold()
              .child(`${known} confirmed open · ${done}/${this.rows.length} repos checked`),
          )
          .when(unavailable > 0, (el) =>
            el.child(
              div().text_color(t.blocked).child(`${unavailable} unavailable — counts incomplete`),
            ),
          )
          .child(
            Input.new(this.search)
              .id("dependabot-search")
              .h(30)
              .px(8)
              .border_1()
              .border_color(t.input)
              .rounded(5)
              .bg(t.background),
          )
          .child(
            h_flex()
              .gap(5)
              .flex_wrap()
              .children(
                ["all", ...severities].map((s) =>
                  this.button(
                    `severity-${s}`,
                    s === "all" ? "All severities" : s,
                    (cx) => {
                      this.severity = s;
                      cx.notify();
                    },
                    t,
                    s === this.severity,
                  ),
                ),
              ),
          )
          .child(
            this.button(
              "issues-only",
              this.onlyIssues ? "Showing: alerts / unavailable" : "Showing: all repos",
              (cx) => {
                this.onlyIssues = !this.onlyIssues;
                cx.notify();
              },
              t,
              this.onlyIssues,
            ),
          ),
      )
      .when(!!this.error, (el) =>
        el.child(
          div()
            .px(12)
            .py(8)
            .text_color(t.blocked)
            .child(`Refresh failed: ${this.error} · Previous results may be stale.`),
        ),
      )
      .when(this.warnings.length > 0, (el) =>
        el.child(
          div()
            .px(12)
            .pb(8)
            .text_size(11)
            .text_color(t.blocked)
            .child([...new Set(this.warnings)].join(" ")),
        ),
      )
      .child(
        v_flex()
          .id("dependabot-scroll")
          .flex_1()
          .min_h(0)
          .overflow_y_scrollbar()
          .children(
            rows.flatMap((row) => [
              v_flex()
                .id(`repo-${row.repository}`)
                .px(12)
                .py(10)
                .gap(5)
                .border_b_1()
                .border_color(t.border)
                .bg(this.selected === row.repository ? t.selected : t.surface)
                .cursor_pointer()
                .hover((s) => s.bg(t.hover))
                .on_click((_event, cx) => {
                  this.selected = this.selected === row.repository ? "" : row.repository;
                  this.alertNumber = null;
                  cx.notify();
                })
                .child(div().font_semibold().child(row.repository))
                .child(
                  div()
                    .text_color(row.status === "unavailable" ? t.blocked : t.muted)
                    .text_size(11)
                    .child(
                      row.status === "loading"
                        ? "Fetching…"
                        : row.status === "unavailable"
                          ? `Unavailable${row.stale ? " · previous count " + total(row) : ""}`
                          : `${total(row)} open · ${age(row)}`,
                    ),
                )
                .when(!!row.counts, (el) => el.child(this.counts(row, t)))
                .when(row.status === "unavailable", (el) =>
                  el.child(div().text_size(11).text_color(t.muted).child(row.error)),
                ),
              ...(selected?.repository === row.repository
                ? [this.repositoryPanel(selected, t)]
                : []),
            ]),
          )
          .when(!rows.length, (el) =>
            el.child(
              div()
                .p(12)
                .text_color(t.muted)
                .child(
                  this.loading
                    ? "Discovering local GitHub checkouts…"
                    : !this.loaded
                      ? "Refresh to load repositories."
                      : !this.rows.length
                        ? "No GitHub checkouts found. Configure scan roots (see README)."
                        : "No repositories match these filters.",
                ),
            ),
          ),
      )
      .child(
        div()
          .px(12)
          .py(8)
          .text_size(10)
          .text_color(t.dim)
          .child(
            "Security alerts, not update PRs · Refresh is manual · Data becomes stale after 10m",
          ),
      );
  }
}
