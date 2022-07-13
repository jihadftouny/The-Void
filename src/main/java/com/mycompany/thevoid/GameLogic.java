/*
 * Click nbfs://nbhost/SystemFileSystem/Templates/Licenses/license-default.txt to change this license
 * Click nbfs://nbhost/SystemFileSystem/Templates/Classes/Class.java to edit this template
 */
package com.mycompany.thevoid;

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
    public static boolean isRunning;

//    public static Dice lvlUpDice = new Dice(2, 4);
    
    
    
    //dices
//    public static Dice lvlUpDice = new Dice(2, 6);
//    static Dice ultraDice = new Dice(3, 100);

    //random encounter variables
    public static String[] encounters = {"Battle", "Battle", "Battle", "Rest", "Rest"}; //this will be used as an rng factor, rest will show parts of the lore while giving xp
    public static String[] enemies = {"Ogre", "Orc", "Goblin", "Kobolt", "Rat"};

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
        System.out.println("THE VOID\nA Text Rpg by Jihanger\nv0.0.1");
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

        Story.printIntro(player);

        isRunning = true;
        //start main game loop
        gameLoop();
    }

    public static void checkAct() {
        if (player.xp >= 10 && act == 1) {
            act = 2;
            place = 1;
            Story.firstActOutro();
            player.chooseTrait();
            Story.secondActIntro();
            //assign new values to enemies
            enemies[0] = "Evil Jooj";
            enemies[1] = "Evil Jooj";
            enemies[2] = "Evil Jooj";
            enemies[3] = "Evil Jooj";
            enemies[4] = "Evil Jooj";
            //assign new values to encounters
            encounters[0] = "Battle";
            encounters[1] = "Battle";
            encounters[2] = "Battle";
            encounters[3] = "Rest";
            encounters[4] = "Rest";

        } else if (player.xp >= 30 && act == 2) {
            act = 3;
            place = 2;
            Story.secondActOutro();
            player.chooseTrait();
            Story.thirdActIntro();
            enemies[0] = "Evil Jooj";
            enemies[1] = "Evil Jooj";
            enemies[2] = "Evil Jooj";
            enemies[3] = "Evil Jooj";
            enemies[4] = "Evil Jooj";
            //assign new values to encounters
            encounters[0] = "Battle";
            encounters[1] = "Battle";
            encounters[2] = "Battle";
            encounters[3] = "Rest";
            encounters[4] = "Rest";
        } else if (player.xp >= 90 && act == 3) {
            act = 4;
            place = 3;
            Story.thirdActOutro();
            player.chooseTrait();
            Story.fourthActIntro();
            enemies[0] = "Evil Jooj";
            enemies[1] = "Evil Jooj";
            enemies[2] = "Evil Jooj";
            enemies[3] = "Evil Jooj";
            enemies[4] = "Evil Jooj";
            //assign new values to encounters
            encounters[0] = "Battle";
            encounters[1] = "Battle";
            encounters[2] = "Battle";
            encounters[3] = "Rest";
            encounters[4] = "Rest";
        } else if (player.xp >= 240 && act == 4) {
            act = 5;
            place = 4;
            Story.fourthActOutro();
            player.chooseTrait();
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
                characterInfo();
            } else {
                playerDied();

            }
        }
    }

    public static void continueJourney() {
        checkAct();

//        check if game isnt in last act
        if (act != 5) {
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
        System.out.println("XP: " + player.xp + "\tGold: " + player.gold);
        printDivider(20);
        System.out.println("Potions: " + player.pots);
        printDivider(20);
        System.out.println("ATK: " + player.Stats[0]);
        System.out.println("DEF: " + player.Stats[1]);

        //print chosen traits
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
        battle(new Enemy(enemies[(int) (Math.random() * enemies.length)], player.xp));
    }

    //main battle method
    public static void battle(Enemy enemy) {
        //main abttle loop
        while (true) {
            clearConsole();
            printHeader(player.name + "\nHP: " + player.hp + "/" + player.maxHp + "\n", true);
            printHeader(enemy.name + "\nHP: " + enemy.hp + "/" + enemy.maxHp, false);
            printHeader("ATK: " + enemy.Stats[0] +  " DEF: " + enemy.Stats[1], false);
            System.out.println("Choose an action: ");
            printDivider(20);
            System.out.println("(1) Fight\n(2) Use Potion\n(3) Run Away");
            int input = readInt("-> ", 3);

            switch (input) {
                case 1:
                    //fight
                    //calculate dmg and dmgTook
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
                    System.out.println("You dealt " + dmg + " damage to " + enemy.name + ".");
                    System.out.println(enemy.name + " dealt " + dmgTook + " damage to you.");
                    anythingToContinue();

                    //if player hp is 0 or enemy defeated
                    if (player.hp <= 0) {
                        playerDied();
                        return;
                    } else if (enemy.hp <= 0) {
                        //tell player he won
                        printHeader("You defeated " + enemy.name + "!", true);
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
                            printHeader("You ran away from " + enemy.name + "...", true);
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

    public static void shop() {
        clearConsole();
        printHeader("You meet a myserious stranger. He offers you something:", true);
        int price = (int) (Math.random() * (10 + player.pots * 3) + 10 + player.pots);
        System.out.println("Magic Potion: " + price + " gold.");
        printDivider(20);
        System.out.println("Do you want to buy one?\n(1) Yes\n(2) Maybe next time");
        int input = readInt("->", 2);

        if (input == 1) {
            clearConsole();
            if (player.gold >= price) {
                System.out.println("You have bought the potion!\nYou now have a total of " + player.pots + " potions.");
                player.gold -= price;
                player.pots++;
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
                    int hpRestored = (int) Math.random() * (player.xp / 4 + 1) + 10;
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
        }else{
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
