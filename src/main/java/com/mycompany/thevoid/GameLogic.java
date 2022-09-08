/*
 * Click nbfs://nbhost/SystemFileSystem/Templates/Licenses/license-default.txt to change this license
 * Click nbfs://nbhost/SystemFileSystem/Templates/Classes/Class.java to edit this template
 */
package com.mycompany.thevoid;

import java.util.ArrayList;
import java.util.Scanner;
//import javax.script.ScriptEngine;

/**
 *
 * @author jihad
 */
public class GameLogic {

    //variables
    static Scanner scanner = new Scanner(System.in);
    static Player player;
    public static Enemy enemy; 
    public static boolean isRunning;
    
    

//    public static Dice lvlUpDice = new Dice(2, 4);
    //dices
//    public static Dice lvlUpDice = new Dice(2, 6);
//    static Dice ultraDice = new Dice(3, 100);
    //random encounter variables
    public static String[] encounters = {"Battle", "Battle", "Battle", "Rest", "Rest"}; //this will be used as an rng factor, rest will show parts of the lore while giving xp
    public static String[] enemies = {"Beast", "Beast", "Beast", "Beast", "Beast"};

    //story variables
    public static int place = 0, act = 1;
    public static String[] places = {"First Floor", "Second Floor", "Third Floor", "Fourth Floor", "Fifth Floor"};

// ------- Main Game Methods ---------------------------------------------------   
    public static void startGame() {
        boolean nameSet = false;
        String name;

        //print title screen
        clearConsole();
        printDivider(40);
        printDivider(40);
        System.out.println("THE VOID\nA Text Rpg by Jihanger\nvAlpha");
        printDivider(40);
        printDivider(40);

        anythingToContinue();

        //getting player name
        do {
            clearConsole();
            printHeader("What's your name?", true);
            System.out.print("-> ");
            name = scanner.next();
            clearConsole();
            printHeader("Your name is " + name + "\nIs that correct?", true);
            System.out.println("(1) Yes!\n(2) No, I want to change my name");
            int input = readInt("-> ", 2);
            if (input == 1) {
                nameSet = true;
            }
        } while (!nameSet);

        //create new player obejct
        player = new Player(name);

        //this sets player iniitial stats after his creation maxhp based on his hitdie and con mod, also setting his hp with maxhp
        player.maxHp = player.hitDiePlayer.sides + player.StatsMods[2];
        player.hp = player.maxHp;
        player.ArmorClass = 10 + player.StatsMods[2];

        Story.printIntro(player);

        System.out.println(player.Stats[0] + " " + player.Stats[1] + " " + player.Stats[2] + " " + player.Stats[3] + " " + player.Stats[4] + " " + player.Stats[5]);

        //START DEBUG
        //END DEBUG
        anythingToContinue(); //debug
        isRunning = true;
        //start main game loop
        gameLoop();
    }

    public static void checkAct() {
        if (player.xp >= 10 && act == 1) {
            act = 2;
            place = 1;
            Story.firstActOutro();
            player.levelUp();
            Story.secondActIntro();
            //assign new values to enemies
//            enemies[0] = "Evil Jooj";
//            enemies[1] = "Evil Jooj";
//            enemies[2] = "Evil Jooj";
//            enemies[3] = "Evil Jooj";
//            enemies[4] = "Evil Jooj";
//            //assign new values to encounters
//            encounters[0] = "Battle";
//            encounters[1] = "Battle";
//            encounters[2] = "Battle";
//            encounters[3] = "Rest";
//            encounters[4] = "Rest";

        } else if (player.xp >= 30 && act == 2) {
            act = 3;
            place = 2;
            Story.secondActOutro();
            player.levelUp();
            Story.thirdActIntro();
//            enemies[0] = "Evil Jooj";
//            enemies[1] = "Evil Jooj";
//            enemies[2] = "Evil Jooj";
//            enemies[3] = "Evil Jooj";
//            enemies[4] = "Evil Jooj";
//            //assign new values to encounters
//            encounters[0] = "Battle";
//            encounters[1] = "Battle";
//            encounters[2] = "Battle";
//            encounters[3] = "Rest";
//            encounters[4] = "Rest";
        } else if (player.xp >= 90 && act == 3) {
            act = 4;
            place = 3;
            Story.thirdActOutro();
            player.levelUp();
            Story.fourthActIntro();
//            enemies[0] = "Evil Jooj";
//            enemies[1] = "Evil Jooj";
//            enemies[2] = "Evil Jooj";
//            enemies[3] = "Evil Jooj";
//            enemies[4] = "Evil Jooj";
//            //assign new values to encounters
//            encounters[0] = "Battle";
//            encounters[1] = "Battle";
//            encounters[2] = "Battle";
//            encounters[3] = "Rest";
//            encounters[4] = "Rest";
        } else if (player.xp >= 240 && act == 4) {
            act = 5;
            place = 4;
            Story.fourthActOutro();
            player.levelUp();
            Story.fifthActIntro();
            //call final battle
            finalBattle();
        }
    }

    public static void gameLoop() {
        while (isRunning) {
            printMenu();
            int input = readInt("->", 3);
            if (input == 1) {
                continueJourney();
            } else if (input == 2) {
                shop();
                characterInfo();
            } else {
                playerDied();

            }
        }
    }

    public static void continueJourney() {
        int currentAct = act; 
        checkAct();
        

//        check if game isnt in last act
        if (act != 5 && currentAct == act) {
            randomEncounter();
        }
    }

    public static void printMenu() {
        clearConsole();
        printHeader(places[place], true);
        System.out.println("Choose an Action:");
        printDivider(20);
        System.out.println("(1) Continue on your descent");
        System.out.println("(2) Character Info");
        System.out.println("(3) Exit Game");
    }

    public static void characterInfo() {
        clearConsole();
        printHeader("CHARACTER INFORMATION", true);
        //player xp and gold
        System.out.println(player.name + ":\tHP: " + player.hp + "/" + player.maxHp);
        printDivider(20);
        System.out.println(player.classPlayer + "\nXP: " + player.xp + "\tGold: " + player.gold);
        printDivider(20);
        System.out.println("Weapon: " + player.equippedWeapon.itemName);
        System.out.println("Armor: " + player.equippedArmor.itemName);
        System.out.println("Potions: " + player.pots);
        System.out.println("Skill Charges: " + player.skillCharges + "/" + player.maxSkillCharges);
        printDivider(20);
        System.out.println("STR: " + player.Stats[0] + " (" + player.StatsMods[0] + ")" + "\tDEX: " + player.Stats[1] + " (" + player.StatsMods[1] + ")"
                + "\nCON: " + player.Stats[2] + " (" + player.StatsMods[2] + ")" + "\tINT: " + player.Stats[3] + " (" + player.StatsMods[3] + ")"
                + "\nWIS: " + player.Stats[4] + " (" + player.StatsMods[4] + ")" + "\tCHA: " + player.Stats[5] + " (" + player.StatsMods[5] + ")");

        //print chosen traits (DEPRECATED)
        if (player.numAtkUpgrades > 0) {
            System.out.println("Offensive trait: " + player.atkUpgrades[player.numAtkUpgrades - 1]);
        }
        if (player.numDefUpgrades > 0) {
            System.out.println("Defensive trait: " + player.defUpgrades[player.numDefUpgrades - 1]);
        }
        printDivider(20);
        anythingToContinue();
    }

// ------- Battle/Rest/Shop methods -----------------------------------------------
    public static void randomEncounter() {
        //reandom number for encounters array 
        int encounter = (int) (Math.random() * encounters.length);

        switch (encounters[encounter]) {
            case "Battle":
                randomBattle();
                break;

            case "Rest":
                takeRest();
                break;

            default:
                shop();
                break;
        }
    }

    //creating a random battle
    public static void randomBattle() {
        clearConsole();
        printHeader("You encountered an enemy. Fight for your life!", true);
        anythingToContinue();

        //creating new enemy with random name
        enemy = new Enemy(enemies[(int) (Math.random() * enemies.length)], player.xp);
        battle(enemy);
    }

    //main battle method
    public static void battle(Enemy enemy) {
        //main abttle loop
        while (true) {
            clearConsole();
            printHeader(player.name + "\nHP: " + player.hp + "/" + player.maxHp + "\n", true);
            printHeader(enemy.fullName + "\nHP: " + enemy.hp + "/" + enemy.maxHp, false);
            printHeader("ATK: " + enemy.Stats[0] + " DEF: " + enemy.Stats[2], false);
            System.out.println("Choose an action: ");
            printDivider(20);
            System.out.println("(1) Fight\n(2) Use Potion\n(3) Run Away");
            int input = readInt("-> ", 3);

            switch (input) {
                case 1:
                    //fight
                    //calculate dmg and dmgTook
                    
                    // HERE WE WILL CHECK FOR CONDITIONS THAT UNABLE ATTACKING 
                    // THEN SET A BOOLEAN THAT LATER WILL ALLOW DMG TO BE MORE THAN 0
                    // AND CHANGE DAMAGE MESSAGE ACCORDINGLY
                    // MAKE AN IF ELSE CHAIN WITH HIGHEST PRIORITY STAT ON TOP (IF STUN ELSE SLEEP ELSE BROKEN BONE, ETC) THIS WAY THE HIGH PRIORITY WILL SHOW
                    
                    int dmg = player.attack() - enemy.defend();
                    int dmgTook = enemy.attack() - player.defend();
                    

                    //check that dmg isnt negative
                    if (dmgTook < 0) {
                        dmg -= dmgTook / 2; //add some damage if player defend well
                        dmgTook = 0;
                    }
                    if (dmg < 0) {
                        dmg = 0;
                    }

                    //deal damage
                    player.hp -= dmgTook;
                    enemy.hp -= dmg;

                    //print battle info
                    clearConsole();
                    printHeader("BATTLE", true);
                    System.out.println("You dealt " + dmg + " damage to " + enemy.fullName + ".");
                    if (Enemy.pickedSkillString != null){
                        System.out.println(enemy.pickedSkillString);
                        Enemy.pickedSkillString = null;
                    }
                    System.out.println(enemy.fullName + " dealt " + dmgTook + " damage to you.");
                    Condition.tickConditions();
                    anythingToContinue();

                    //if player hp is 0 or enemy defeated
                    if (player.hp <= 0) {
                        playerDied();
                        return;
                    } else if (enemy.hp <= 0) {
                        //tell player he won
                        printHeader("You defeated " + enemy.fullName + "!", true);
                        //increase player xp
                        player.xp += enemy.xp;
                        System.out.println("You earned " + enemy.xp + " XP!");
                        //random drops
                        boolean addRest = (Math.random() * 100 + 1 <= 25);
                        int goldEarned = (int) (Math.random() * enemy.xp);

                        //add random drops
                        if (addRest) {
                            player.restsLeft++;
                            System.out.println("You earned the chance to have an additional rest!");
                        }

                        player.gold += goldEarned;
                        System.out.println("You earned " + goldEarned + " gold!");

                        anythingToContinue();
                        return;
                    }
                    break;
                case 2:
                    //use potion
                    if (player.pots > 0 && player.hp < player.maxHp) {
                        clearConsole();
                        System.out.println("Do you want to drink a potion? (" + player.pots + " left.)");
                        System.out.println("(1) Yes\n(2) Maybe later");
                        input = readInt("->", 2);
                        if (input == 1) {
                            clearConsole();
                            player.pots--;
                            player.hp = player.maxHp;
                            System.out.println("You drank the potion and you're back to " + player.maxHp + " HP.");
                        }
                    } else {
                        clearConsole();
                        System.out.println("You don't have or can't drink a potion.");
                        anythingToContinue();
                    }
                    break;
                default:
                    //run away
                    clearConsole();
                    if (act != 5) {
                        //chance of 35% escape
                        if (Math.random() * 10 + 1 <= 3.5) {
                            printHeader("You ran away from " + enemy.fullName + "...", true);
                            anythingToContinue();
                            return;
                        } else {
                            printHeader("You didn't manage to escape...", true);
                            //calculate damage
                            dmgTook = enemy.attack();
                            player.hp -= dmgTook;
                            System.out.println("In your hurry you took " + dmgTook + " damage!");
                            anythingToContinue();
                            if (player.hp <= 0) {
                                playerDied();
                                return;
                            }

                        }
                    } else {
                        printHeader("YOU CANNOT ESCAPE", true);
                        anythingToContinue();
                    }
            }
        }
    }

    public static void playerDied() {
        clearConsole();
        printHeader("You died...", true);
        printHeader("You earned " + player.xp + " XP on your journey. Great job and try to earn more next time!", false);
        printHeader("Thank you for playing The Void. I hope you enjoyed it!", false);
        anythingToContinue();
        isRunning = false;
    }

    public static Item pickItemShop(Item[] itemArray) {
        
        ArrayList<Item> tempItemList = new ArrayList<>();
        int pickIndex;

        
       
        for (int i = 0; i < itemArray.length; i++) {
            // common has weight 5
            if ("Common".equals(itemArray[i].itemRarity)) {
                tempItemList.add(itemArray[i]);
                tempItemList.add(itemArray[i]);
                tempItemList.add(itemArray[i]);
                tempItemList.add(itemArray[i]);
                tempItemList.add(itemArray[i]);
            } else if ("Rare".equals(itemArray[i].itemRarity)) {
                tempItemList.add(itemArray[i]);
                tempItemList.add(itemArray[i]);
                tempItemList.add(itemArray[i]);
            } else if ("Legendary".equals(itemArray[i].itemRarity)) {
                tempItemList.add(itemArray[i]);
            }
        }
        
        pickIndex = (int)(Math.random() * tempItemList.size());

        return tempItemList.get(pickIndex);
    }

    public static void shop() {
        clearConsole();
        printHeader("You meet a mysterious stranger. He offers you something:", true);

        int itemTypeShop = (int) (Math.random() * 2) + 1; //this is going to be used to define what type of item will be picked
        Item itemGenerated = new Item("null", 0, "null") {
        };
        Item itemCurrent = new Item("null", 0, "null") {
        };
        // if ARMOR
        if (itemTypeShop == 1) {
            switch (act) {
                case 1:
                    itemGenerated = pickItemShop(Armor.ArmorsAct1);
                    break;
                case 2:
                    itemGenerated = pickItemShop(Armor.ArmorsAct2);
                    break;
                case 3:
                    itemGenerated = pickItemShop(Armor.ArmorsAct3);
                    break;
                default:
                    itemGenerated = pickItemShop(Armor.ArmorsAct4);
                    break;
            }
            itemCurrent = player.equippedArmor;
        } else if (itemTypeShop == 2) {
            switch (act) {
                case 1:
                    itemGenerated = pickItemShop(Weapon.WeaponsAct1);
                    break;
                case 2:
                    itemGenerated = pickItemShop(Weapon.WeaponsAct2);
                    break;
                case 3:
                    itemGenerated = pickItemShop(Weapon.WeaponsAct3);
                    break;
                default:
                    itemGenerated = pickItemShop(Weapon.WeaponsAct4);
                    break;
            }
            itemCurrent = player.equippedWeapon;
        }
        int price = (int) (Math.random() * ((10* act + act * 5) - (act * 5) + 1) + (act * 5));
        
        System.out.println("This '" + itemGenerated.itemName + "' good stuff, mate. Ye can get it for " + price + " units and ye gimme yer '" + itemCurrent.itemName + "'.");

        //there will be no weights on rarity
        
        
        
        printDivider(20);
        System.out.println("Do you want to buy it?\n(1) Yes\n(2) Maybe next time");
        int input = readInt("->", 2);

        if (input == 1) {
            clearConsole();
            if (player.gold >= price) {
                System.out.println("You traded your '" + itemCurrent.itemName + "' for the stranger's '" + itemGenerated.itemName + "'.");
                player.gold -= price;
                if (itemTypeShop == 1) {
                    player.equippedArmor = (Armor)itemGenerated;
                } else if (itemTypeShop == 2){
                    player.equippedWeapon = (Weapon)itemGenerated;
                }
                anythingToContinue();
            } else {
                System.out.println("You don't have enough gold.");
                anythingToContinue();
            }
        }
    }

    public static void takeRest() {
        clearConsole();
        Lore loreRest = new Lore(act);
        printHeader(loreRest.loreTitle, true);
        System.out.println(loreRest.loreText);
        printDivider(20);
        if (player.restsLeft >= 1) {
            printHeader("Do you want to take a rest? (" + player.restsLeft + " rest(s) left).", false);
            System.out.println("(1) Yes\n(2) No, not now");
            int input = readInt("->", 2);
            clearConsole();
            if (input == 1) {
                //player takes rest

                if (player.hp < player.maxHp) {
                    int hpRestored = (int) (Math.random() * (player.xp / 4 + 1) + 10);
                    player.hp += hpRestored;
                    if (player.hp > player.maxHp) {
                        player.hp = player.maxHp;
                    }
                    System.out.println("You took a rest and restored " + hpRestored + " health.");
                    System.out.println("You're now at " + player.hp + "/" + player.maxHp + " health.");
                    player.restsLeft--;
                } else {//player at max hp
                    System.out.println("You're at full health. There is no need to rest now!");

                }
            }
        } else {
            System.out.println("You voyage through the jooj without rest.");
        }
        anythingToContinue();

    }

    //final battle
    public static void finalBattle() {
        //create final boos
        battle(new Enemy("Jorginho Matagal", 300));
        //print proper ending
        Story.printEnd(player); //if player loses he enters the loop endgame
        isRunning = false;
    }
// ------- UI methods ---------------------------------------------------
    //input method

    public static int readInt(String prompt, int userChoices) {
        int input;

        do {
            System.out.print(prompt);
            try {
                input = Integer.parseInt(scanner.next());
            } catch (Exception e) {
                input = -1;
                System.out.print("Please enter an integer!");
            }
        } while (input < 1 || input > userChoices);
        return input;
    }

    //clear console
    public static void clearConsole() {
        for (int i = 0; i < 50; i++) {
            System.out.println("");
        }
    }

    //print line divider
    public static void printDivider(int dashes) {
        for (int i = 0; i < dashes; i++) {
            System.out.print("-");
        }
        System.out.println("");
    }

    //print header
    public static void printHeader(String headerText, boolean firstHeader) {
        if (firstHeader) {
            clearConsole();
        }
        printDivider(40);
        System.out.println(headerText);
        printDivider(40);
    }

    //press anything to continue
    public static void anythingToContinue() {
        System.out.println("Type something to continue...");
        scanner.next();
    }

}
