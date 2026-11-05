# Dnd Prompt Helper
Web Api to retrieve json with cool Generated Dnd information for quick retrieval. Just going to be simple GET REST requests. Has a web page that dynamically renders the json as cards to get a random prompt, or the entire list.

Live URL: https://dnd-generator-pythonflask.onrender.com/cards

## Requirements
- [Python 3](https://www.python.org/downloads/)

## To Setup
- Setup Project
```
git clone "https://github.com/EonViljoen/Dnd-Generator-PythonFlask.git"
cd Dnd-Generator-PythonFlask
python -m venv venv*
.\venv\Scripts\activate*
```

* - If Virtual Envirornment is used. To deactivate Virtual Environment, use `deactivate` in the Virtual Environment directory.

## Run App Locally
 ```
pip install -r .\requirements.txt
python .\main.py
```

## Adding Custom Prompts
Json is structure a specific way for the App to be able to read single / multiple entries. Structure is as follows:

```
{
  "Main Topic" : {
    "Sub Topic" : [
      "Entry 1",
      ...
    ] 
  },
  ...
}
```

To add a new Main / Sub Topic, simply add a object / collection into the json file, either at the end or a middle of Json Collections.

## Using Your Own Tables (no upload to the server)
On the generator page, **Customize** lets each user tailor the tables without changing them for anyone else:

- **Show or hide tables**: tick the tables you want on `/cards`. Stored in the browser's localStorage.
- **Load your own JSON** (same structure as above), either *added to the defaults* (new tables are added, entries for an existing table are appended) or *replacing the defaults*. The file is validated in the browser and stored in IndexedDB. It is never sent to the server, so rolling, searching and Quick builds run in the browser while custom data is active.
- **Download the defaults as a template** (`/api/getall`), **Export** your file, or **Remove** it to go back to the built-in tables.

Because the data lives in that browser only, it doesn't sync between devices and is lost if site data is cleared. Export keeps a copy.

## Topics
|Topic      |Sub Topics               |About                              |
|-----------|-------------------------|-----------------------------------|
|Dungeon    |Puzzles, Hidden Doors, Traps, Curiosities, Riddles, Defenses.|Ideas for inpromptu hazards and challenges usually encountered in a dungeon.|
|Encounter  |Aerial, Beach, Desert, Forest, Jungle, Snow, Spooky and Tavern Encounters.|Enemies for combat encouters to suit the location. |
|Items      |Artifacts, Gifts, Instruments, Items, Objects, Potions, Treasures and more.|Useful, or unuseful, items to encounters on your adventures.|
|Misc       |Journey Starting Points, Odd Occurrences, Punishment, Scenarios, Side Effects and more.|Random snippets to make use during a campaign to add some improvised flair.|
|NPCs       |Characters, Creatures, Enemies, Familiars, Villagers, Villians and more.|Non-Playable-Characters to encounter while out and about and your party ask "Who's that person?".|
|Quests     |Complications, Encounters, Events, Hooks, Legends, Point of Interest, Quests|Objectives for when the players decide to not follow the main quest and you need to think of something on the fly.|
|Town       |Factions, Festivals, Games, Inns, Islands, Laws, Stalls, Taverns and more.|That extra bit to help your settlements feel more fleshed out.|

## TODO
- Create users
- Create users login
- Allow jsons to be editable
