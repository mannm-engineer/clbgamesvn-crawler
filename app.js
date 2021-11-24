const fs = require('fs');
const { readFile, writeFile } = require('fs/promises');
const { Cluster } = require('puppeteer-cluster');

main();

async function main() {
  const cluster = await Cluster.launch({
    concurrency: Cluster.CONCURRENCY_PAGE,
    maxConcurrency: 4,
    puppeteerOptions: {
      executablePath: 'C:\\Users\\minhm\\Downloads\\chrome-win\\chrome.exe',
    },
    timeout: Math.pow(2, 30),
    monitor: true,
  });

  cluster.on('taskerror', (err, data, willRetry) => {
    console.log(err.message);
  });

  crawlForum(cluster);

  await cluster.idle();
  await cluster.close();
}

function getSize(cluster, { url }) {
  return cluster.execute(async ({ page }) => {
    const maxURL = `${url}&page=${Number.MAX_SAFE_INTEGER}`;
    page.setDefaultTimeout(0);
    await page.setRequestInterception(true);
    page.on('request', (interceptedRequest) => {
      interceptedRequest.url() !== maxURL ? interceptedRequest.abort() : interceptedRequest.continue();
    });
    await page.goto(maxURL);
    const title = await page.title();
    const PATTERN = " - Trang ";
    const start = title.indexOf(PATTERN);
    const size = start > -1 ? title.substring(start + PATTERN.length) : 1;
    return size;
  });
}

async function crawlForum(cluster) {
  const forumURL = 'https://www.clbgamesvn.com/diendan/forumdisplay.php?f=579';
  const forumSize = await getSize(cluster, { url: forumURL });

  for (let i = forumSize; i > 0; i--) {
    cluster.queue(async ({ page }) => {
      const forumPageURL = `${forumURL}&page=${i}`;
      page.setDefaultTimeout(0);
      await page.setRequestInterception(true);
      page.on('request', (interceptedRequest) => {
        interceptedRequest.url() !== forumPageURL ? interceptedRequest.abort() : interceptedRequest.continue();
      });
      await page.goto(forumPageURL);

      const threads = await page.evaluate(() => {
        const threads = [];
        const threadNodes = document.querySelectorAll("#threads > .threadbit");

        threadNodes.forEach((threadNode) => {
          const titleNode = threadNode.querySelector(".threadtitle .title");
          const labelNode = threadNode.querySelector(
            ".threadmeta .author > .label"
          );
          const repliesNode = threadNode.querySelector(
            ".threadstats > li:nth-child(1) > a"
          );
          const viewsNode = threadNode.querySelector(
            ".threadstats > li:nth-child(2)"
          );
          const lastPostAtNode = threadNode.querySelector(
            ".threadlastpost > dd:nth-child(3)"
          );
          const pagesTotalNode = threadNode.querySelector('.pagination dd span:last-child');
          const pagesTotal = pagesTotalNode !== null ? parseInt(pagesTotalNode.textContent) : 1;

          threads.push({
            oldId: new URL(titleNode.href).searchParams.get("t"),
            title: titleNode.textContent,
            url: titleNode.href,
            authorUrl: labelNode.querySelector("a").href,
            postedAt: labelNode.textContent.split(", ")[1],
            replies: repliesNode.textContent,
            views: viewsNode.textContent.split("Xem: ")[1].replace(/,/g, ""),
            lastPostAt: lastPostAtNode.innerText.trim(),
            pages: Array.from({ length: pagesTotal }, (_, i) => i + 1),
          });
        });

        return threads;
      });

      threads.forEach(thread => {
        thread.pages.forEach(async page => {
          const html = await crawlPage(cluster, {
            url: `${thread.url}&page=${page}`,
          });
          fs.mkdir(`./${thread.oldId}`, { recursive: true }, (err) => {
            if (err) throw err;

            writeFile(`./${thread.oldId}/${page}.html`, html);
          });
        });
      });
    })
  }
}

function crawlPage(cluster, { url }) {
  return cluster.execute(async ({ page }) => {
    page.setDefaultTimeout(0);
    // await page.setRequestInterception(true);
    // page.on('request', (interceptedRequest) => {
    //   interceptedRequest.url() !== url ? interceptedRequest.abort() : interceptedRequest.continue();
    // });
    await page.goto(url);
    const content = await page.content();
    return content;
  });
}

async function getCookies(cluster, { username, password }) {
  cluster.queue(async ({ page }) => {
    page.setDefaultTimeout(0);
    await page.setRequestInterception(true);
    page.on('request', (interceptedRequest) => {
      if (
        interceptedRequest.url() === 'http://www.clbgamesvn.com/diendan/popup/popup.js')
        interceptedRequest.abort();
      else interceptedRequest.continue();
    });
    await page.goto('http://www.clbgamesvn.com/diendan/showthread.php?t=314368');

    await page.type('#navbar_username', username);
    await page.type('#navbar_password_hint', password);
    await page.keyboard.press('Enter');
    await page.waitForNavigation();

    const cookies = await page.cookies();
    saveCookies(cookies)
  });
}

async function saveCookies(cookies) {
  try {
    count++;
    console.log('Save');
    await writeFile(`./cookies_${Date.now()}.json`, JSON.stringify(cookies, null, 2));
  } catch (err) {
    console.log(err);
  }
}

async function useCookies(cluster) {
  try {
    const rawCookies = await readFile('./cookies.json');
    const cookies = JSON.parse(rawCookies);
    cluster.queue(async ({ page }) => {
      await page.setCookie(...cookies);
    })
  } catch (err) {
    if (err.code === 'ENOENT') {
      return;
    }
    console.log(err);
  }
}