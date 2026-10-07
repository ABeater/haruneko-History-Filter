<script lang="ts">
    import { onMount, onDestroy} from 'svelte';
    import { fade } from 'svelte/transition';

    interface Props {
        item: MediaContainer<MediaItem>;
        selected: boolean;
        hover: boolean;
        multilang ?: boolean;
        attributes ?: ReadonlyArray<MediaAttribute>;
        onView: (MouseEvent) => void;
        onmouseup: (MouseEvent) => void;
        onmousedown: (MouseEvent) => void;
        onmouseenter: (MouseEvent) => void;
        oncontextmenu: (MouseEvent) => void;
    };
    let { item, selected, hover , multilang = false, attributes = [], onView, onmouseup, onmousedown, onmouseenter, oncontextmenu }: Props  = $props();

    import { Button, ClickableTile } from 'carbon-components-svelte';
    import BookmarkFilled from 'carbon-icons-svelte/lib/BookmarkFilled.svelte';
    import CloudDownload from 'carbon-icons-svelte/lib/CloudDownload.svelte';
    import Download from 'carbon-icons-svelte/lib/Download.svelte';
    import EventIncident from 'carbon-icons-svelte/lib/EventIncident.svelte';
    import FolderOpen from 'carbon-icons-svelte/lib/FolderOpen.svelte';
    import Pause from 'carbon-icons-svelte/lib/Pause.svelte';
    import PauseFuture from 'carbon-icons-svelte/lib/PauseFuture.svelte';
    import View from 'carbon-icons-svelte/lib/View.svelte';
    import ViewFilled from 'carbon-icons-svelte/lib/ViewFilled.svelte';
    import VolumeFileStorage from 'carbon-icons-svelte/lib/VolumeFileStorage.svelte';
    import type {
        MediaItem,
        MediaContainer,
        StoreableMediaContainer,
    } from '../../../engine/providers/MediaPlugin';
    import {
        FlagType,
        type EntryFlagEventData,
    } from '../../../engine/ItemflagManager';
    import { Store as UI } from '../stores/Stores.svelte';
    import { DownloadTask, Status } from '../../../engine/DownloadTask';
    import { Key as GlobalKey } from '../../../engine/SettingsGlobal';
    import type { Directory } from '../../../engine/SettingsManager';
    import { GlobalSettings } from '../stores/Settings.svelte';
    import { Presence, type DownloadHistoryEntryState, type HistoryChangedEvent } from '../../../engine/DownloadHistory';
    import { CanOpenFolders, OpenEntryFolder } from '../lib/folders';
    import { GetAttributeValuesNotInTitle } from '../lib/ItemFilter';
    import { MediaAttribute } from '../../../engine/providers/MediaPlugin';
    
    import { Tags, type Tag } from '../../../engine/Tags';
    const availableLanguageTags = Tags.Language.toArray();

    // NOTE: This relies on all language tags having a unicode flag prefix in their corresponding `Title`
    function extractUnicodeFlagFromTags(tags: ReadonlyArray<Tag>): string {
        const languageTagTitleResourceKey = tags.find((tag) =>
            availableLanguageTags.includes(tag),
        )?.Title;
        return (
            GlobalSettings.Locale[languageTagTitleResourceKey]
                ?.call(undefined)
                ?.slice(0, 4) ?? '🏴'
        );
    }

    // Show the attributes (e.g., group) to distinguish releases with the same title, unless the website already added them to the title
    let attributesNotInTitle = $derived(GetAttributeValuesNotInTitle(item, ...attributes));
    let tooltip = $derived([
        item.Title,
        ...[ MediaAttribute.Group, MediaAttribute.Type ]
            .filter((attribute) => item.GetAttribute(attribute).length > 0)
            .map((attribute) => `${attribute}: ${item.GetAttribute(attribute).join(', ')}`),
    ].join('\n'));

    let flag: FlagType = $state();
    const flagiconmap = new Map<FlagType, any>([
        [FlagType.Viewed, ViewFilled],
        [FlagType.Current, BookmarkFilled],
    ]);

    let flagicon = $derived(flagiconmap.get(flag) || View);

    async function OnFlagChangedCallback(flagData: EntryFlagEventData) {
        if (flagData.Entry === item) {
            flag = flagData.Kind;
        } else if (flagData.Kind === FlagType.Current) {
            flag = await HakuNeko.ItemflagManager.GetItemFlagType(item);
        }
    }
    HakuNeko.ItemflagManager.EntryFlagEventChannel.Subscribe(
        OnFlagChangedCallback,
    );
    onMount(async () => {
        refreshHistory();
        flag = await HakuNeko.ItemflagManager.GetItemFlagType(item);
    });
    onDestroy(() => {
        HakuNeko.ItemflagManager.EntryFlagEventChannel.Unsubscribe(
            OnFlagChangedCallback,
        );
        downloadTask?.Status.Unsubscribe(refreshDownloadStatus);
        HakuNeko.DownloadManager.Queue.Unsubscribe(taskQueueChanged);
        HakuNeko.DownloadHistory.Changed.Unsubscribe(onHistoryChanged);
    });

    let downloadTask: DownloadTask = $state();
    let downloadTaskStatus: Status=$state();

    async function taskQueueChanged(tasks: DownloadTask[]) {
        downloadTask?.Status.Unsubscribe(refreshDownloadStatus);
        downloadTask = tasks.find((task) => task.Media.IsSameAs(item));
        downloadTask?.Status.Subscribe(refreshDownloadStatus);
    }
    HakuNeko.DownloadManager.Queue.Subscribe(taskQueueChanged);
    async function refreshDownloadStatus(newstatus: Status, _task: DownloadTask) {
        downloadTaskStatus = newstatus;
    }

    // Persistent download history (survives restarts), independent from the state of the download task
    let history: DownloadHistoryEntryState = $state({ Downloaded: false, Presence: null, Location: null });
    let wasDownloaded = $derived(history.Downloaded || downloadTaskStatus === Status.Completed);
    let isMissing = $derived(history.Downloaded && history.Presence === Presence.Missing);
    let isPresent = $derived(!isMissing && (history.Presence === Presence.Present || downloadTaskStatus === Status.Completed));
    const canOpenFolders = CanOpenFolders();

    function refreshHistory() {
        history = HakuNeko.DownloadHistory.GetEntryState(item);
    }
    function onHistoryChanged(event: HistoryChangedEvent) {
        if(!event?.MediaKey || event.MediaKey === HakuNeko.DownloadHistory.GetMediaKey(item?.Parent)) {
            refreshHistory();
        }
    }
    HakuNeko.DownloadHistory.Changed.Subscribe(onHistoryChanged);

    async function openFolder() {
        if(canOpenFolders) {
            await OpenEntryFolder(item);
        }
    }

    /**
     * Download a chapter again whose files are missing, using the existing download task (retry) if available.
     */
    async function downloadAgain() {
        if(!downloadTask) {
            return addDownload(item as StoreableMediaContainer<MediaItem>);
        }
        try {
            await HakuNeko.SettingsManager.OpenScope().Get<Directory>(GlobalKey.MediaDirectory).EnsureAccess();
        } catch(error) {
            // TODO: Use appropriate error visualization ...
            alert(error?.message ?? error);
            return;
        }
        downloadTask.Run();
    }

    async function addDownload(item: StoreableMediaContainer<MediaItem>) {
        try {
            await HakuNeko.SettingsManager.OpenScope().Get<Directory>(GlobalKey.MediaDirectory).EnsureAccess();
        } catch(error) {
            // TODO: Use appropriate error visualization ...
            alert(error?.message ?? error);
            return;
        }
        await window.HakuNeko.DownloadManager.Enqueue(item);
    }

    async function removeDownload(task: DownloadTask) {
        await window.HakuNeko.DownloadManager.Dequeue(task)
    }

</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
    class="listitem"
    role="listitem"
    in:fade
    class:selected
    class:hover
    class:active={UI.selectedItem?.Identifier === item?.Identifier}
    {onmouseup}
    {onmousedown}
    {onmouseenter}
    {oncontextmenu}
>
    {#if !downloadTaskStatus || downloadTaskStatus === Status.Completed}
        {#if isMissing}
            <Button
                size="small"
                kind="ghost"
                tooltipPosition="right"
                tooltipAlignment="end"
                iconDescription="Downloaded before, but the files are missing: click to download again"
                onclick={downloadAgain}
            >
                <FolderOpen class="history-missing" fill="var(--cds-support-warning)" />
            </Button>
        {:else if isPresent}
            <Button
                size="small"
                kind="ghost"
                tooltipPosition="right"
                tooltipAlignment="end"
                iconDescription={canOpenFolders ? 'Downloaded: click to open the folder' : 'Downloaded'}
                onclick={openFolder}
            >
                <FolderOpen class="history-present" fill="var(--cds-support-success)" />
            </Button>
        {:else if wasDownloaded}
            <Button
                size="small"
                kind="ghost"
                tooltipPosition="right"
                tooltipAlignment="end"
                iconDescription="Downloaded before (files not yet verified on disk)"
                onclick={openFolder}
            >
                <FolderOpen class="history-unverified" fill="var(--cds-icon-secondary)" />
            </Button>
        {:else}
            <Button
                role="download"
                size="small"
                kind="ghost"
                tooltipPosition="right"
                tooltipAlignment="end"
                icon={CloudDownload}
                iconDescription="Download"
                onclick={() => addDownload(item as StoreableMediaContainer<MediaItem>)}
            />
        {/if}
    {:else if downloadTaskStatus === Status.Queued}
        <Button
            size="small"
            kind="ghost"
            tooltipPosition="right"
            tooltipAlignment="end"
            iconDescription="Cancel"
            onclick={() => addDownload(item as StoreableMediaContainer<MediaItem>)}
        >
            <PauseFuture fill="var(--cds-icon-secondary)" />
        </Button>
    {:else if downloadTaskStatus === Status.Paused}
        <Button
            size="small"
            kind="ghost"
            tooltipPosition="right"
            tooltipAlignment="end"
            iconDescription="Cancel (paused)"
            onclick={() => removeDownload(downloadTask)}
        >
            <Pause fill="var(--cds-toggle-off)" />
        </Button>
    {:else if downloadTaskStatus === Status.Downloading}
        <Button
            size="small"
            kind="ghost"
            tooltipPosition="right"
            tooltipAlignment="end"
            iconDescription="Cancel (downloading...)"
            onclick={() => removeDownload(downloadTask)}
        >
            <Download fill="var(--cds-support-info)" />
        </Button>

    {:else if downloadTaskStatus === Status.Processing}
        <Button
            size="small"
            kind="ghost"
            iconDescription="Cancel (processing...)"
            onclick={() => removeDownload(downloadTask)}
        >
            <VolumeFileStorage fill="var(--cds-support-info)" />
        </Button>
    {:else if downloadTaskStatus === Status.Failed}
        <Button
            size="small"
            kind="danger-ghost"
            tooltipPosition="right"
            tooltipAlignment="end"
            icon={EventIncident}
            iconDescription="Error: click to retry (detailed error in download tasks)"
            onclick={() => downloadTask.Run()}
        />
    {:else}
        <Button
            size="small"
            kind="ghost"
            tooltipPosition="right"
            tooltipAlignment="end"
            iconDescription="Download"
            onclick={() => addDownload(item as StoreableMediaContainer<MediaItem>)}
        >
            <CloudDownload fill="var(--cds-icon-01)" />
        </Button>
    {/if}
    <Button
        role="preview"
        size="small"
        kind="ghost"
        icon={flagicon}
        tooltipPosition="right"
        tooltipAlignment="end"
        iconDescription="View"
        onclick={(event) => onView(event)}
    />
    <ClickableTile class="title" onclick={(event) => onView(event)}>
        {#if multilang}
            <span class="multilang">
                {extractUnicodeFlagFromTags(item.Tags.Value)}
            </span>
        {/if}
        <span class="itemtitle" title={tooltip}>{item.Title}</span>
        {#if attributesNotInTitle.length > 0}
            <span class="attributes" title={tooltip}>{attributesNotInTitle.join(', ')}</span>
        {/if}
    </ClickableTile>
</div>

<style>
    .listitem {
        display: flex;
        user-select: none;
    }
    .listitem:hover,
    .listitem.hover {
        background-color: var(--cds-hover-row);
        --cds-ui-01: var(--cds-hover-row);
    }
    .listitem.hover {
        background-color: var(--cds-active-secondary);
        --cds-ui-01: var(--cds-active-secondary);
    }
    .listitem.selected {
        background-color: var(--cds-selected-ui);
        --cds-ui-01: var(--cds-selected-ui);
    }
    .listitem.active {
        background-color: var(--cds-active-ui);
        --cds-ui-01: var(--cds-active-ui);
    }
    .listitem :global(.title) {
        flex: auto;
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
        min-height: unset;
        display: flex;
        align-items: center;
        padding: 0;
        padding-left: 0.5em;
    }
    .listitem :global(button) {
        min-height: unset;
        width: unset;
        min-width: unset;
        padding-left: 0.3em;
        padding-right:0;
    }
    .listitem :global(button:hover) {
        --cds-icon-01: var(--cds-hover-secondary);
    }
    .multilang {
        opacity: 0.7;
        margin-right: 0.4em;
    }
    .itemtitle {
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .attributes {
        flex-shrink: 0;
        max-width: 50%;
        overflow: hidden;
        text-overflow: ellipsis;
        opacity: 0.7;
        font-style: italic;
        margin-left: 0.6em;
    }
</style>
