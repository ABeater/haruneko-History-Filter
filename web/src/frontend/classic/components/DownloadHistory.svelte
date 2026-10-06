<script lang="ts">
    import { onMount, onDestroy } from 'svelte';
    import { Modal, Button, Dropdown, InlineLoading, InlineNotification, Search, Tag } from 'carbon-components-svelte';
    import ChevronDown from 'carbon-icons-svelte/lib/ChevronDown.svelte';
    import ChevronRight from 'carbon-icons-svelte/lib/ChevronRight.svelte';
    import DocumentExport from 'carbon-icons-svelte/lib/DocumentExport.svelte';
    import DocumentImport from 'carbon-icons-svelte/lib/DocumentImport.svelte';
    import FolderOpen from 'carbon-icons-svelte/lib/FolderOpen.svelte';
    import Launch from 'carbon-icons-svelte/lib/Launch.svelte';
    import Renew from 'carbon-icons-svelte/lib/Renew.svelte';
    import {
        Presence,
        RecordOrigin,
        ReconcileOutcome,
        type HistoryEntryView,
        type HistoryExportResult,
        type HistoryMediaView,
        type HistoryStatistics,
        type ImportPreview,
        type ImportSummary,
        type ReconcileResult,
        type ScanState,
    } from '../../../engine/DownloadHistory';
    import { Key as GlobalKey } from '../../../engine/SettingsGlobal';
    import type { Directory } from '../../../engine/SettingsManager';
    import { Store as UI } from '../stores/Stores.svelte';
    import { AllWebsites, CountEntries, FilterHistory, ListHistoryWebsites, type HistoryGroup, type HistoryWebsite } from '../lib/HistoryFilter';

    interface Props {
        isModalOpen: boolean;
    };
    let { isModalOpen = $bindable(false) }: Props = $props();

    const pageSize = 100;

    let statistics: HistoryStatistics = $state(HakuNeko.DownloadHistory.GetStatistics());
    let views: HistoryMediaView[] = $state(HakuNeko.DownloadHistory.GetMediaViews());
    let scan: ScanState = $state(HakuNeko.DownloadHistory.ScanState.Value);
    let preview: ImportPreview | null = $state(null);
    let importResult: Promise<ImportSummary> | null = $state(null);
    let exportResult: Promise<HistoryExportResult> | null = $state(null);
    let error: string | null = $state(null);

    // ---------------------------------------------------------------------------------------------
    // History list (search, filter, expandable media rows)
    // ---------------------------------------------------------------------------------------------

    type Filter = 'all' | Presence;

    let query = $state('');
    let filter: Filter = $state('all');
    let websiteFilter: string = $state(AllWebsites);
    let expanded: Record<string, boolean> = $state({});
    let limit = $state(pageSize);

    const filterItems = [
        { id: 'all', text: 'All chapters' },
        { id: Presence.Present, text: 'Present' },
        { id: Presence.Missing, text: 'Missing' },
        { id: Presence.Unknown, text: 'Not verified' },
    ];

    let websites: HistoryWebsite[] = $derived(ListHistoryWebsites(views));
    let websiteItems = $derived([
        { id: AllWebsites, text: 'All websites' },
        ...websites.map(website => ({
            id: website.ID,
            text: `${website.Title} (${website.Media} manga)${website.Available ? '' : ' - not available'}`,
        })),
    ]);
    let groups: HistoryGroup[] = $derived(FilterHistory(views, { Query: query, Presence: filter, WebsiteID: websiteFilter }));
    let isFiltering = $derived(query.trim().length > 0 || filter !== 'all' || websiteFilter !== AllWebsites);

    $effect(() => {
        // Start with the first page again whenever the search or a filter changes
        query;
        filter;
        websiteFilter;
        limit = pageSize;
    });

    $effect(() => {
        // Fall back to all websites when the selected website is no longer part of the history (e.g., after an import into an empty history)
        if(websiteFilter !== AllWebsites && !websites.some(website => website.ID === websiteFilter)) {
            websiteFilter = AllWebsites;
        }
    });

    function clearFilters() {
        query = '';
        filter = 'all';
        websiteFilter = AllWebsites;
    }

    function isExpanded(group: HistoryGroup): boolean {
        // Rows expand automatically when filtering by status or when chapter titles matched the search
        return expanded[group.View.Key] ?? (filter !== 'all' || group.MatchedEntries);
    }

    function presenceColor(presence: Presence): string {
        switch(presence) {
            case Presence.Present: return 'var(--cds-support-success)';
            case Presence.Missing: return 'var(--cds-support-warning)';
            default: return 'var(--cds-icon-secondary)';
        }
    }

    function presenceLabel(presence: Presence): string {
        switch(presence) {
            case Presence.Present: return 'Files present';
            case Presence.Missing: return 'Files missing';
            default: return 'Not verified yet';
        }
    }

    function formatDate(time: number): string {
        return new Date(time).toLocaleDateString();
    }

    function describeEntry(entry: HistoryEntryView): string {
        switch(entry.Origin) {
            case RecordOrigin.Scan:
                return entry.LastDownloaded > 0 ? `Downloaded ${formatDate(entry.LastDownloaded)}` : 'Found on disk (downloaded before the history existed)';
            case RecordOrigin.Import:
                return entry.LastDownloaded > 0 ? `Imported, downloaded ${formatDate(entry.LastDownloaded)}` : 'Imported';
            default: {
                const times = entry.DownloadCount > 1 ? ` (${entry.DownloadCount} times)` : '';
                return entry.LastDownloaded > 0 ? `Downloaded ${formatDate(entry.LastDownloaded)}${times}` : 'Downloaded';
            }
        }
    }

    /**
     * Show the manga in the main view, where its chapters can be viewed or downloaded again.
     */
    function goToMedia(view: HistoryMediaView) {
        const media = HakuNeko.DownloadHistory.ResolveMedia(view.WebsiteID, view.MediaID);
        if(!media) {
            return;
        }
        UI.selectedItem = undefined;
        UI.selectedPlugin = media.Parent;
        UI.selectedMedia = media;
        isModalOpen = false;
    }

    // ---------------------------------------------------------------------------------------------
    // Synchronization with the engine
    // ---------------------------------------------------------------------------------------------

    function refresh() {
        statistics = HakuNeko.DownloadHistory.GetStatistics();
        views = HakuNeko.DownloadHistory.GetMediaViews();
    }

    function onScanStateChanged(state: ScanState) {
        scan = state;
        refresh();
    }

    onMount(() => {
        HakuNeko.DownloadHistory.ScanState.Subscribe(onScanStateChanged);
        HakuNeko.DownloadHistory.Changed.Subscribe(refresh);
    });

    onDestroy(() => {
        HakuNeko.DownloadHistory.ScanState.Unsubscribe(onScanStateChanged);
        HakuNeko.DownloadHistory.Changed.Unsubscribe(refresh);
    });

    // ---------------------------------------------------------------------------------------------
    // Rescan, import & export
    // ---------------------------------------------------------------------------------------------

    function resetMessages() {
        error = null;
        preview = null;
        importResult = null;
        exportResult = null;
    }

    async function rescan(allowEmptyRoot = false) {
        resetMessages();
        try {
            // A rescan is triggered by the user, so the permission for the media directory can be requested
            await HakuNeko.SettingsManager.OpenScope().Get<Directory>(GlobalKey.MediaDirectory).EnsureAccess();
        } catch(reason) {
            error = reason?.message ?? String(reason);
            return;
        }
        await HakuNeko.DownloadHistory.Reconcile({ AllowEmptyRoot: allowEmptyRoot });
    }

    function describeScan(result: ReconcileResult): string {
        const parts = [ `${result.Present} present`, `${result.Missing} missing` ];
        if(result.Unverified > 0) {
            parts.push(`${result.Unverified} could not be verified (previous state kept)`);
        }
        if(result.Relocated > 0) {
            parts.push(`${result.Relocated} found at a new location`);
        }
        let text = parts.join(', ') + '.';
        if(result.Untracked > 0) {
            text += ` ${result.Untracked} existing files or folders are not linked yet, they are added when you open the chapter list of their manga.`;
        }
        return text;
    }

    async function prepareImport() {
        resetMessages();
        try {
            const result = await HakuNeko.DownloadHistory.PrepareImport();
            preview = result.Cancelled ? null : result;
        } catch(reason) {
            error = reason?.message ?? String(reason);
        }
    }

    function commitImport() {
        const commit = preview?.Commit;
        preview = null;
        if(commit) {
            importResult = commit();
        }
    }

    function exportHistory() {
        resetMessages();
        exportResult = HakuNeko.DownloadHistory.Export();
    }
</script>

<Modal
    id="downloadHistoryModal"
    size="lg"
    bind:open={isModalOpen}
    modalHeading="Download history"
    preventCloseOnClickOutside
    primaryButtonText="Close"
    on:click:button--primary={() => (isModalOpen = false)}
>
    <p class="description">
        HakuNeko remembers every chapter that was downloaded successfully, even after a restart.
        A <span class="present">green</span> folder means the files are in the media directory,
        a <span class="missing">yellow</span> folder means the chapter was downloaded before, but its files are gone.
    </p>

    <div class="statistics">
        <Tag type="cool-gray">{websites.length} {websites.length === 1 ? 'website' : 'websites'}</Tag>
        <Tag type="cool-gray">{statistics.Media} manga</Tag>
        <Tag type="cool-gray">{statistics.Entries} chapters</Tag>
        <Tag type="green">{statistics.Present} present</Tag>
        <Tag type="warm-gray">{statistics.Missing} missing</Tag>
        {#if statistics.Unverified > 0}
            <Tag type="outline">{statistics.Unverified} not verified</Tag>
        {/if}
    </div>

    <div class="toolbar">
        <Search size="sm" placeholder="Search manga, chapters or websites" bind:value={query} />
        <Dropdown size="sm" type="inline" labelText="Website" bind:selectedId={websiteFilter} items={websiteItems} />
        <Dropdown size="sm" type="inline" labelText="Show" bind:selectedId={filter} items={filterItems} />
    </div>
    {#if isFiltering}
        <div class="filter-summary">
            <span class="details">Showing {groups.length} manga, {CountEntries(groups)} chapters</span>
            <Button size="small" kind="ghost" onclick={clearFilters}>Clear filters</Button>
        </div>
    {/if}

    <div class="history-list" role="list">
        {#each groups.slice(0, limit) as group (group.View.Key)}
            {@const view = group.View}
            {@const open = isExpanded(group)}
            <div class="media-row" role="listitem">
                <button class="toggle" aria-expanded={open} onclick={() => (expanded[view.Key] = !open)}>
                    {#if open}<ChevronDown />{:else}<ChevronRight />{/if}
                    <span class="media-title" title={view.MediaTitle}>{view.MediaTitle}</span>
                    <span class="website" title="Downloaded from {view.WebsiteTitle} ({view.WebsiteID})">
                        {#if view.WebsiteIcon}<img class="website-icon" src={view.WebsiteIcon} alt="" />{/if}
                        {view.WebsiteTitle}{#if !view.WebsiteAvailable} (website not available){/if}
                    </span>
                </button>
                <span class="counts">
                    <Tag size="sm" type="green" title="Files present">{view.Present}</Tag>
                    {#if view.Missing > 0}<Tag size="sm" type="warm-gray" title="Files missing">{view.Missing}</Tag>{/if}
                    {#if view.Unverified > 0}<Tag size="sm" type="outline" title="Not verified yet">{view.Unverified}</Tag>{/if}
                </span>
                <Button
                    size="small"
                    kind="ghost"
                    icon={Launch}
                    iconDescription={view.WebsiteAvailable ? 'Go to manga' : 'The website is not available'}
                    tooltipPosition="left"
                    disabled={!view.WebsiteAvailable}
                    onclick={() => goToMedia(view)}
                />
            </div>
            {#if open}
                <ul class="entries">
                    {#each group.Entries as entry (entry.EntryID)}
                        <li class="entry-row">
                            <span class="status" title={presenceLabel(entry.Presence)}>
                                <FolderOpen fill={presenceColor(entry.Presence)} aria-label={presenceLabel(entry.Presence)} />
                            </span>
                            <span class="entry-title" title={entry.Title}>{entry.Title}</span>
                            <span class="details">{describeEntry(entry)}</span>
                        </li>
                    {/each}
                </ul>
            {/if}
        {:else}
            <p class="details empty">
                {#if views.length === 0}
                    No downloads recorded yet. Downloaded chapters will appear here.
                {:else}
                    No chapters match the search or filters.
                    <Button size="small" kind="ghost" onclick={clearFilters}>Clear filters</Button>
                {/if}
            </p>
        {/each}
        {#if groups.length > limit}
            <Button size="small" kind="ghost" onclick={() => (limit += pageSize)}>
                Show more ({groups.length - limit} more manga)
            </Button>
        {/if}
    </div>

    <h6>Files in the media directory</h6>
    <div class="section">
        {#if scan.Running}
            <InlineLoading status="active" description="Scanning the media directory ..." />
        {:else if scan.Last?.Outcome === ReconcileOutcome.Completed}
            <InlineLoading status="finished" description="Last scan: {new Date(scan.Last.Finished).toLocaleString()}" />
            <p class="details">{describeScan(scan.Last)}</p>
        {:else if scan.Last?.Outcome === ReconcileOutcome.AccessRequired}
            <InlineNotification lowContrast hideCloseButton kind="info" title="Access required" subtitle="Click 'Rescan downloads' to allow HakuNeko to read the media directory." />
        {:else if scan.Last?.Outcome === ReconcileOutcome.Unavailable}
            <InlineNotification lowContrast hideCloseButton kind="info" title="No media directory" subtitle="Select a media directory in the settings." />
        {:else if scan.Last?.Outcome === ReconcileOutcome.Failed}
            <InlineNotification lowContrast hideCloseButton kind="warning" title="The media directory could not be accessed" subtitle="Nothing was changed, the last known state is kept. Reconnect the drive and rescan. ({scan.Last.Error})" />
        {:else if scan.Last?.Outcome === ReconcileOutcome.EmptyRoot}
            <InlineNotification lowContrast hideCloseButton kind="warning" title="The media directory is empty" subtitle="Nothing was changed. If the drive is disconnected, reconnect it and rescan. If you deleted all downloads, you can mark them as missing." />
            <Button size="small" kind="danger-tertiary" onclick={() => rescan(true)}>Mark all as missing</Button>
        {/if}
        <Button size="small" kind="tertiary" icon={Renew} disabled={scan.Running} onclick={() => rescan()}>Rescan downloads</Button>
    </div>

    <h6>Backup & transfer</h6>
    <div class="section">
        <div class="actions">
            <Button size="small" kind="tertiary" icon={DocumentImport} onclick={prepareImport}>Import</Button>
            <Button size="small" kind="tertiary" icon={DocumentExport} onclick={exportHistory}>Export</Button>
        </div>
        <p class="details">Importing only restores the history, it never downloads anything.</p>

        {#if preview}
            <div class="statistics">
                <Tag type="cyan">{preview.Summary.Found} found</Tag>
                <Tag type="green">{preview.Summary.New} new</Tag>
                <Tag type="cool-gray">{preview.Summary.AlreadyPresent} already present</Tag>
                {#if preview.Summary.DuplicatesInFile > 0}<Tag type="outline">{preview.Summary.DuplicatesInFile} duplicates</Tag>{/if}
                {#if preview.Summary.Rejected > 0}<Tag type="red">{preview.Summary.Rejected} could not be identified</Tag>{/if}
            </div>
            {#if preview.Summary.UnavailableWebsite > 0}
                <p class="details">{preview.Summary.UnavailableWebsite} of the new records belong to websites which are not available in this installation, they are kept and listed as "website not available".</p>
            {/if}
            <div class="actions">
                <Button size="small" onclick={commitImport}>Merge into history</Button>
                <Button size="small" kind="ghost" onclick={() => (preview = null)}>Cancel</Button>
            </div>
        {/if}

        {#if importResult}
            {#await importResult}
                <InlineLoading status="active" description="Import in progress ..." />
            {:then summary}
                <InlineLoading status="finished" description="Import completed: {summary.New} new, {summary.AlreadyPresent} already present" />
            {:catch reason}
                <InlineLoading status="error" description="Import failed: {reason?.message ?? reason}" />
            {/await}
        {/if}

        {#if exportResult}
            {#await exportResult}
                <InlineLoading status="active" description="Export in progress ..." />
            {:then result}
                {#if result.Cancelled}
                    <InlineLoading status="error" description="Cancelled" />
                {:else}
                    <InlineLoading status="finished" description="Exported {result.Exported} chapters" />
                {/if}
            {:catch reason}
                <InlineLoading status="error" description="Export failed: {reason?.message ?? reason}" />
            {/await}
        {/if}

        {#if error}
            <InlineNotification lowContrast kind="error" title="Error" subtitle={error} on:close={() => (error = null)} />
        {/if}
    </div>
</Modal>

<style>
    .description {
        margin-bottom: 1em;
    }
    .present {
        color: var(--cds-support-success);
    }
    .missing {
        color: var(--cds-support-warning);
    }
    .statistics, .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5em;
        margin-bottom: 0.5em;
    }
    .toolbar {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5em;
        align-items: center;
        margin-bottom: 0.25em;
    }
    .toolbar > :global(.bx--search) {
        flex: 1 1 16em;
    }
    .filter-summary {
        display: flex;
        align-items: center;
        gap: 0.5em;
        margin-bottom: 0.25em;
    }
    .history-list {
        max-height: 40vh;
        overflow-y: auto;
        background-color: var(--cds-field-01);
        padding: 0.25em;
    }
    .media-row {
        display: flex;
        align-items: center;
        gap: 0.25em;
        min-height: 2em;
    }
    .media-row:hover, .entry-row:hover {
        background-color: var(--cds-hover-row);
    }
    .toggle {
        flex: auto;
        display: flex;
        align-items: center;
        gap: 0.5em;
        min-width: 0;
        padding: 0.25em;
        border: none;
        background: none;
        color: var(--cds-text-01);
        font: inherit;
        text-align: left;
        cursor: pointer;
    }
    .toggle:focus-visible {
        outline: 2px solid var(--cds-focus);
    }
    .media-title, .entry-title {
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
    }
    .media-title {
        font-weight: 600;
    }
    .website {
        flex: none;
        display: flex;
        align-items: center;
        gap: 0.35em;
        font-size: 0.875em;
        color: var(--cds-text-02);
    }
    .website-icon {
        width: 1.2em;
        height: 1.2em;
        border-radius: 20%;
    }
    .counts {
        display: flex;
        flex: none;
    }
    .entries {
        list-style: none;
        margin: 0 0 0.25em 1.75em;
        padding: 0;
    }
    .entry-row {
        display: flex;
        align-items: center;
        gap: 0.5em;
        min-height: 1.75em;
    }
    .status {
        display: flex;
        flex: none;
    }
    .entry-title {
        flex: auto;
        min-width: 0;
    }
    .entry-row .details {
        flex: none;
    }
    h6 {
        margin-top: 1em;
    }
    .section {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 0.5em;
        margin-top: 0.5em;
    }
    .details {
        font-size: 0.875em;
        color: var(--cds-text-02);
    }
    .empty {
        padding: 0.5em;
    }
    .history-list :global(button.bx--btn) {
        min-height: unset;
        padding-top: 0.25em;
        padding-bottom: 0.25em;
    }
</style>
