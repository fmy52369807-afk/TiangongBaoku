/**
 * Category profiles and output mode definitions.
 */

function categoryProfile(category) {
    const profiles = {
        novel: {
            itemName: '章节',
            payloadKind: 'text',
            openLabel: '阅读正文',
            entryLabel: '目录',
            detailFields: {
                name: ['name', 'bookName', 'book_name', 'novelName', 'title'],
                author: ['author', 'authorName', 'writer'],
                coverUrl: ['cover', 'coverUrl', 'pic', 'picUrl', 'thumb_url'],
                intro: ['intro', 'summary', 'description', 'bookIntro', 'abstract'],
            },
        },
        comic: {
            itemName: '话',
            payloadKind: 'images',
            openLabel: '阅读漫画',
            entryLabel: '目录',
            detailFields: {
                name: ['name', 'title', 'comicName'],
                author: ['author', 'authorName', 'writer'],
                coverUrl: ['cover', 'coverUrl', 'pic', 'picUrl'],
                intro: ['intro', 'brief', 'description', 'summary'],
            },
        },
        audio: {
            itemName: '音频',
            payloadKind: 'audio',
            openLabel: '播放音频',
            entryLabel: '节目列表',
            detailFields: {
                name: ['name', 'title', 'albumName', 'book_name'],
                author: ['author', 'announcer', 'anchorName', 'nickname'],
                coverUrl: ['cover', 'coverUrl', 'pic', 'picUrl', 'thumb_url'],
                intro: ['intro', 'desc', 'description', 'abstract'],
            },
        },
        music: {
            itemName: '歌曲',
            payloadKind: 'audio',
            openLabel: '播放音乐',
            entryLabel: '播放列表',
            detailFields: {
                name: ['name', 'title', 'songName'],
                author: ['author', 'artist', 'singer', 'uname'],
                coverUrl: ['cover', 'coverUrl', 'pic', 'picUrl', 'thumb'],
                intro: ['intro', 'album', 'description', 'des'],
            },
        },
        video: {
            itemName: '集',
            payloadKind: 'video',
            openLabel: '播放视频',
            entryLabel: '播放源 / 剧集',
            detailFields: {
                name: ['name', 'title', 'video_name'],
                author: ['author', 'actor', 'celebrity'],
                coverUrl: ['cover', 'coverUrl', 'pic', 'picUrl', 'img'],
                intro: ['intro', 'info', 'description', 'desc'],
            },
        },
        game: {
            itemName: '入口',
            payloadKind: 'link',
            openLabel: '打开 / 下载',
            entryLabel: '入口',
            detailFields: {
                name: ['name', 'title'],
                author: ['author', 'developer'],
                coverUrl: ['cover', 'coverUrl', 'pic', 'picUrl'],
                intro: ['intro', 'description', 'html5introduce'],
            },
        },
        special: {
            itemName: '资源',
            payloadKind: 'link',
            openLabel: '操作 / 下载',
            entryLabel: '资源列表',
            detailFields: {
                name: ['name', 'title', 'server_filename'],
                author: ['author', 'owner', 'developername'],
                coverUrl: ['cover', 'coverUrl', 'pic', 'picUrl'],
                intro: ['intro', 'description', 'message'],
            },
        },
    };
    return profiles[category] || profiles.special;
}

function outputMode(category, ruleContent = {}) {
    if (ruleContent.imageStyle || category === 'comic') return 'html';
    if (category === 'novel') return 'text';
    return 'raw';
}

module.exports = {
    categoryProfile,
    outputMode,
};
