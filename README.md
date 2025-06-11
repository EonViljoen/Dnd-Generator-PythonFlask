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
- Create a Homepage
- Create users
- Create users login
- Allow users to upload custom jsons in required format
- Allow jsons to be editable
